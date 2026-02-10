const exec = require('@actions/exec');
const action = require('../src/index');

jest.mock('@actions/exec');

describe('determinePhpVersionFromPhpConfig', () => {
    test('php version can be determined from php-config', async () => {
        exec.getExecOutput.mockResolvedValue({
            stdout: "8.3.10-whatever\n",
            exitCode: 0,
        });

        const version = await action.determinePhpVersionFromPhpConfig();

        expect(version).toBe('8.3');
    });
});
