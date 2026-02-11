const core = require("@actions/core");
const exec = require("@actions/exec");
const github = require("@actions/github");
const fs = require("fs");
const path = require("path");

async function determineExtensionNameFromComposerJson() {
    core.info("Detecting extension name from composer.json...");

    if (!fs.existsSync("composer.json")) {
        throw new Error("composer.json not found. This does not appear to be a PIE package.");
    }

    const type = (await exec.getExecOutput("jq", ["-r", ".type", "composer.json"], {
        ignoreReturnCode: true
    })).stdout.trim();
    if (type !== "php-ext" && type !== "php-ext-zend") {
        throw new Error(`composer.json type must be "php-ext" or "php-ext-zend", but "${type}" was found.`);
    }

    let extName = (await exec.getExecOutput("jq", ["-r", '."php-ext"."extension-name"', "composer.json"], {
        ignoreReturnCode: true
    })).stdout.trim();

    // If extension-name is not defined, fall back according to package name (without vendor prefix)
    // https://github.com/php/pie/blob/f9cb8d3034697dc5b4054614a25b0860c861e496/src/ExtensionName.php#L58
    if (extName === "null" || extName === "") {
        core.info(".php-ext.extension-name not found in composer.json, falling back to package name...");
        const packageName = (await exec.getExecOutput("jq", ["-r", ".name", "composer.json"], {
            ignoreReturnCode: true
        })).stdout.trim();

        if (packageName === "null" || packageName === "") {
            throw new Error("Could not determine extension name: both .\"php-ext\".\"extension-name\" and .name are missing in composer.json");
        }

        extName = packageName.split('/').pop();
    }

    // If the extension is prefixed with "ext-", strip it
    if (extName.startsWith("ext-")) {
        extName = extName.substring(4);
    }

    // Validate according to https://github.com/php/pie/blob/f9cb8d3034697dc5b4054614a25b0860c861e496/src/ExtensionName.php#L33
    if (!/^[A-Za-z][a-zA-Z0-9_]+$/.test(extName)) {
        throw new Error(`Invalid extension name: "${extName}" - must be alphanumeric/underscores only.`);
    }

    return extName;
}

async function buildExtension() {
    core.info("Building the extension...");
    const configureFlags = core.getInput("configure-flags").split(' ');

    await exec.exec("phpize");
    await exec.exec("./configure", configureFlags);
    await exec.exec("make");
}

async function determinePhpVersionFromPhpConfig() {
    core.info("Detecting php version...");
    return (await exec.getExecOutput("php-config", ["--version"]))
            .stdout
            .trim()
            .split('.')
            .slice(0, 2)
            .join('.');
}

async function determineArchitecture() {
    core.info("Detecting architecture...");
    const arch = process.arch;
    const map = {
        'x64': 'x86_64',
        'arm64': 'arm64',
        'ia32': 'x86'
    };

    if (!map[arch]) {
        throw new Error(`Unsupported architecture: ${arch}`);
    }

    return map[arch];
}

async function determineOperatingSystem() {
    core.info("Detecting operating system...");
    switch (process.platform) {
        case "linux":
        case "darwin":
            return process.platform;
        // aix|freebsd|openbsd|sunos|win32 not supported at this time
        default:
            throw new Error(`Unsupported operating system: ${process.platform}`);
    }
}

async function determineLibcFlavour() {
    core.info("Detecting libc flavour...");
    if (process.platform === "darwin") {
        return "bsdlibc";
    }

    const lddOutput = (await exec.getExecOutput("ldd", ["--version"], { ignoreReturnCode: true })).stdout;
    if (lddOutput.includes("musl")) {
        return "musl";
    }

    return "glibc";
}

async function determinePhpBinary() {
    core.info("Locating PHP binary...");
    const phpBinary = (await exec.getExecOutput("php-config", ["--php-binary"]))
        .stdout
        .trim();

    if (phpBinary === "NONE") {
        core.warning("php-config --php-binary returned NONE, will just use 'php' which... should work?");
        return "php";
    }

    return phpBinary;
}

async function determinePhpDebugMode(phpBinary) {
    core.info("Detecting Zend debug mode...");
    return (await exec.getExecOutput(
            phpBinary,
            ["-n", "-r", "echo PHP_DEBUG ? '-debug' : '';"],
        ))
        .stdout
        .trim();
}

async function determineZendThreadSafeMode(phpBinary) {
    core.info("Detecting Zend thread safety mode...");
    return (await exec.getExecOutput(
            phpBinary,
            ["-n", "-r", "echo ZEND_THREAD_SAFE ? '-zts' : '';"],
        ))
        .stdout
        .trim();
}

async function uploadReleaseAsset(releaseTag, packageFilename) {
    core.info("Uploading release asset...");
    const githubToken = core.getInput("github-token");

    const octokit = github.getOctokit(githubToken);
    const { owner, repo } = github.context.repo;

    core.info(`Searching for release with tag: ${releaseTag} (including drafts)...`);
    const { data: releases } = await octokit.rest.repos.listReleases({
        owner,
        repo,
    });

    const release = releases.find(r => r.tag_name === releaseTag);
    if (!release) {
        throw new Error(`No release found for tag: ${releaseTag}`);
    }

    core.info(`Found release ${release.name || release.tag_name} (ID: ${release.id})`);
    await octokit.rest.repos.uploadReleaseAsset({
        owner,
        repo,
        release_id: release.id,
        name: packageFilename,
        data: fs.readFileSync(path.resolve(packageFilename)),
    });

    core.info("Asset uploaded successfully!");
}

async function extensionDetails() {
    const releaseTag = core.getInput("release-tag");
    const phpBinary = await module.exports.determinePhpBinary();
    const extName = await module.exports.determineExtensionNameFromComposerJson();
    const phpMajorMinor = await module.exports.determinePhpVersionFromPhpConfig();
    const arch = await module.exports.determineArchitecture();
    const os = await module.exports.determineOperatingSystem();
    const libcFlavour = await module.exports.determineLibcFlavour();
    const zendDebug = await module.exports.determinePhpDebugMode(phpBinary);
    const ztsMode = await module.exports.determineZendThreadSafeMode(phpBinary);

    return {
        releaseTag: releaseTag,
        extSoFile: `${extName}.so`,
        extPackageName: `php_${extName}-${releaseTag}_php${phpMajorMinor}-${arch}-${os}-${libcFlavour}${zendDebug}${ztsMode}.zip`
    };
}

async function main() {
    const { releaseTag, extSoFile, extPackageName } = await module.exports.extensionDetails();

    await module.exports.buildExtension();

    await exec.exec("ls", ["-l", "modules"]);

    await exec.exec(`zip -j ${extPackageName} modules/${extSoFile}`);

    await module.exports.uploadReleaseAsset(releaseTag, extPackageName);

    core.setOutput("package-path", extPackageName);
}

module.exports = {
    determineExtensionNameFromComposerJson,
    buildExtension,
    determinePhpVersionFromPhpConfig,
    determineArchitecture,
    determineOperatingSystem,
    determineLibcFlavour,
    determinePhpBinary,
    determinePhpDebugMode,
    determineZendThreadSafeMode,
    uploadReleaseAsset,
    extensionDetails,
    main,
};

if (require.main === module) {
    main();
}
