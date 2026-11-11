"""Real disposable files and subprocess. Never edits this machine's APT state."""
import pathlib
import subprocess
import sys
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[2] / 'scripts/ci_official_apt_mirrors.py'


class MirrorSelection(unittest.TestCase):
    def run_fixture(self, text, source_extra=''):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            mirror = root / 'etc/apt/apt-mirrors.txt'
            mirror.parent.mkdir(parents=True)
            source = root / 'etc/apt/sources.list.d/ubuntu.sources'
            source.parent.mkdir()
            source.write_text('Types: deb\nURIs: mirror+file:/etc/apt/apt-mirrors.txt\nSuites: noble noble-updates noble-security\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n' + source_extra)
            key = root / 'usr/share/keyrings/ubuntu-archive-keyring.gpg'
            key.parent.mkdir(parents=True)
            key.write_bytes(b'fixture-keyring-unchanged-not-a-trust-anchor')
            before = (source.read_bytes(), key.read_bytes())
            mirror.write_text(text)
            result = subprocess.run([sys.executable, str(SCRIPT), '--root', str(root)], capture_output=True, text=True)
            self.assertEqual((source.read_bytes(), key.read_bytes()), before)
            return result.returncode, mirror.read_text()

    def test_removes_only_azure_and_is_idempotent(self):
        original = '# hosted runner mirrors\nhttp://azure.archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://archive.ubuntu.com/ubuntu/\tpriority:2\nhttps://security.ubuntu.com/ubuntu/\tpriority:3\n'
        code, updated = self.run_fixture(original)
        self.assertEqual(code, 0)
        self.assertEqual(updated, original.replace('http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n', ''))
        self.assertEqual(self.run_fixture(updated), (0, updated))

    def test_unexpected_endpoint_fails_without_write(self):
        original = 'https://archive.ubuntu.com/ubuntu/\nhttps://security.ubuntu.com/ubuntu/\nhttps://unverified.invalid/ubuntu/\n'
        code, updated = self.run_fixture(original)
        self.assertNotEqual(code, 0)
        self.assertEqual(updated, original)

    def test_missing_official_fallback_fails_without_write(self):
        original = 'http://azure.archive.ubuntu.com/ubuntu/\n'
        code, updated = self.run_fixture(original)
        self.assertNotEqual(code, 0)
        self.assertEqual(updated, original)

    def test_insecure_source_fails_without_write(self):
        original = 'https://archive.ubuntu.com/ubuntu/\nhttps://security.ubuntu.com/ubuntu/\n'
        code, updated = self.run_fixture(original, 'Trusted: yes\n')
        self.assertNotEqual(code, 0)
        self.assertEqual(updated, original)


if __name__ == '__main__':
    unittest.main()
