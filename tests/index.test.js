const exec = require('@actions/exec');
const fs = require('fs');
const action = require('../src/index');

jest.mock('@actions/core');
jest.mock('@actions/exec');
jest.mock('fs', () => ({
    ...jest.requireActual('fs'),
    existsSync: jest.fn(),
    readFileSync: jest.fn(),
}));

describe('determinePhpVersionFromPhpConfig', () => {
    test('php version can be determined from php-config', async () => {
        exec.getExecOutput.mockResolvedValue({
            stdout: "8.3.10-whatever\n",
            exitCode: 0,
        });

        expect(await action.determinePhpVersionFromPhpConfig())
            .toBe('8.3');
    });
});

describe ('determineExtensionNameFromComposerJson', () => {
    test('composer.json does not exist', async () => {
        await expect(action.determineExtensionNameFromComposerJson())
            .rejects
            .toThrow('composer.json not found. This does not appear to be a PIE package.');
    });

    test('composer.json has type other than php-ext or php-ext-zend', async () => {
        fs.existsSync.mockReturnValue(true);

        // jq -r ".type" composer.json
        exec.getExecOutput.mockResolvedValue({
            stdout: "library\n",
            exitCode: 0,
        });

        await expect(action.determineExtensionNameFromComposerJson())
            .rejects
            .toThrow('composer.json type must be "php-ext" or "php-ext-zend", but "library" was found.');
    });

    test('composer.json has valid php-ext.extension-name with ext- prefix defined', async () => {
        fs.existsSync.mockReturnValue(true);
        exec.getExecOutput.mockImplementation((command, args) => {
            // jq -r ".type" composer.json
            if (args.includes('.type')) {
                return Promise.resolve({ stdout: "php-ext\n", exitCode: 0 });
            }

            // jq -r '."php-ext"."extension-name"' composer.json
            if (args.includes('."php-ext"."extension-name"')) {
                return Promise.resolve({ stdout: "ext-test_ext\n", exitCode: 0 });
            }

            return Promise.reject(new Error('Test did not define command: ' + command + ' with args: ' + args));
        });

        expect(await action.determineExtensionNameFromComposerJson())
            .toBe('test_ext');
    });

    test('composer.json has valid php-ext.extension-name defined', async () => {
        fs.existsSync.mockReturnValue(true);
        exec.getExecOutput.mockImplementation((command, args) => {
            // jq -r ".type" composer.json
            if (args.includes('.type')) {
                return Promise.resolve({ stdout: "php-ext\n", exitCode: 0 });
            }

            // jq -r '."php-ext"."extension-name"' composer.json
            if (args.includes('."php-ext"."extension-name"')) {
                return Promise.resolve({ stdout: "test_ext\n", exitCode: 0 });
            }

            return Promise.reject(new Error('Test did not define command: ' + command + ' with args: ' + args));
        });

        expect(await action.determineExtensionNameFromComposerJson())
            .toBe('test_ext');
    });

    test('composer.json has invalid php-ext.extension-name defined', async () => {
        fs.existsSync.mockReturnValue(true);
        exec.getExecOutput.mockImplementation((command, args) => {
            // jq -r ".type" composer.json
            if (args.includes('.type')) {
                return Promise.resolve({ stdout: "php-ext\n", exitCode: 0 });
            }

            // jq -r '."php-ext"."extension-name"' composer.json
            if (args.includes('."php-ext"."extension-name"')) {
                return Promise.resolve({ stdout: "invalid-ext-name\n", exitCode: 0 });
            }

            return Promise.reject(new Error('Test did not define command: ' + command + ' with args: ' + args));
        });

        await expect(action.determineExtensionNameFromComposerJson())
            .rejects
            .toThrow('Invalid extension name: "invalid-ext-name" - must be alphanumeric/underscores only.');
    });

    test('composer.json has no php-ext.extension-name defined, but package name is valid', async () => {
        fs.existsSync.mockReturnValue(true);
        exec.getExecOutput.mockImplementation((command, args) => {
            // jq -r ".type" composer.json
            if (args.includes('.type')) {
                return Promise.resolve({ stdout: "php-ext\n", exitCode: 0 });
            }

            // jq -r '."php-ext"."extension-name"' composer.json
            if (args.includes('."php-ext"."extension-name"')) {
                return Promise.resolve({ stdout: "\n", exitCode: 0 });
            }

            // jq -r '.name' composer.json
            if (args.includes('.name')) {
                return Promise.resolve({ stdout: "foo/bar\n", exitCode: 0 });
            }

            return Promise.reject(new Error('Test did not define command: ' + command + ' with args: ' + args));
        });

        expect(await action.determineExtensionNameFromComposerJson())
            .toBe('bar');
    });

    test('composer.json has no php-ext.extension-name or package name defined', async () => {
        fs.existsSync.mockReturnValue(true);
        exec.getExecOutput.mockImplementation((command, args) => {
            // jq -r ".type" composer.json
            if (args.includes('.type')) {
                return Promise.resolve({ stdout: "php-ext\n", exitCode: 0 });
            }

            // jq -r '."php-ext"."extension-name"' composer.json
            if (args.includes('."php-ext"."extension-name"')) {
                return Promise.resolve({ stdout: "\n", exitCode: 0 });
            }

            // jq -r '.name' composer.json
            if (args.includes('.name')) {
                return Promise.resolve({ stdout: "\n", exitCode: 0 });
            }

            return Promise.reject(new Error('Test did not define command: ' + command + ' with args: ' + args));
        });

        await expect(action.determineExtensionNameFromComposerJson())
            .rejects
            .toThrow('Could not determine extension name: both .\"php-ext\".\"extension-name\" and .name are missing in composer.json');
    });

    test('composer.json has no php-ext.extension-name defined, and package name is invalid', async () => {
        fs.existsSync.mockReturnValue(true);
        exec.getExecOutput.mockImplementation((command, args) => {
            // jq -r ".type" composer.json
            if (args.includes('.type')) {
                return Promise.resolve({ stdout: "php-ext\n", exitCode: 0 });
            }

            // jq -r '."php-ext"."extension-name"' composer.json
            if (args.includes('."php-ext"."extension-name"')) {
                return Promise.resolve({ stdout: "\n", exitCode: 0 });
            }

            // jq -r '.name' composer.json
            if (args.includes('.name')) {
                return Promise.resolve({ stdout: "foo/invalid-ext-name\n", exitCode: 0 });
            }

            return Promise.reject(new Error('Test did not define command: ' + command + ' with args: ' + args));
        });

        await expect(action.determineExtensionNameFromComposerJson())
            .rejects
            .toThrow('Invalid extension name: "invalid-ext-name" - must be alphanumeric/underscores only.');
    });
});
