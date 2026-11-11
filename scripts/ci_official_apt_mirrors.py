"""Use only the official Ubuntu fallbacks already configured by runner-images.

No DNS/resolver, APT sources, keyring, package versions or trust settings change.
Fail closed if the hosted runner's expected mirror layout has changed.
"""
from pathlib import Path
import argparse

AZURE = 'http://azure.archive.ubuntu.com/ubuntu/'
OFFICIAL = {'https://archive.ubuntu.com/ubuntu/', 'https://security.ubuntu.com/ubuntu/'}


def official_fallbacks(text: str) -> str:
    lines = text.splitlines(keepends=True)
    endpoints = [line.split()[0] for line in lines if line.strip() and not line.lstrip().startswith('#')]
    if not OFFICIAL.issubset(endpoints) or not set(endpoints).issubset(OFFICIAL | {AZURE}):
        raise ValueError('Unexpected runner APT mirror layout; refusing to change it')
    return ''.join(line for line in lines if not line.strip() or line.lstrip().startswith('#') or line.split()[0] != AZURE)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path('/'))
    args = parser.parse_args()
    mirrors = args.root / 'etc/apt/apt-mirrors.txt'
    source = args.root / 'etc/apt/sources.list.d/ubuntu.sources'
    keyring = args.root / 'usr/share/keyrings/ubuntu-archive-keyring.gpg'
    original_source, original_key = source.read_bytes(), keyring.read_bytes()
    if not original_key or b'mirror+file:/etc/apt/apt-mirrors.txt' not in original_source or b'Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg' not in original_source:
        raise ValueError('Unexpected Ubuntu source/keyring; refusing mirror change')
    if b'trusted: yes' in original_source.lower() or b'allow-insecure: yes' in original_source.lower():
        raise ValueError('Insecure source settings are not permitted')
    mirrors.write_text(official_fallbacks(mirrors.read_text()))
    assert source.read_bytes() == original_source and keyring.read_bytes() == original_key
    print('Runner APT mirror selection: official Ubuntu HTTPS fallbacks only; sources, Signed-By and keyring unchanged')


if __name__ == '__main__':
    main()
