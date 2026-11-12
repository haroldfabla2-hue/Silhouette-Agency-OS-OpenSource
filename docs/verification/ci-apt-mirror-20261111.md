# CI official Ubuntu mirror selection

Main merge9a1d297 and its one retry failed before tests, on APT installation of bubblewrap: the hosted runner could not resolve azure.archive.ubuntu.com. Both logs show apt exit100. This is not an application-test pass, and the cancelled/skipped jobs remain incomplete. The merge and previously passing PRhead share exact tree016410f101f27a24cfc92e186d184340cbda2f03.

The runner image itself configures Azure first, then official Ubuntu HTTPS archive/security fallbacks. This change removes only the Azure line from that mirror list before APT. It does not replace DNS, add another source, change sources/keyring/Signed-By, download loose .deb files or disable authentication. Unexpected mirror/source layouts fail closed. apt-get update now treats any index failure as an error instead of silently using old indexes. Bubblewrap, libseccomp, Chromium, F0, the real-process checks, full unit suite, lint/typecheck and all builds remain required and unchanged.

Four real-file/subprocess local checks pass: remove-only/idempotent, unexpected endpoint denied, missing official fallback denied, insecure source denied. Sources and keyring bytes are unchanged in each case. A credential-free fetch of the official noble-security InRelease was verified by gpgv against the already installed Ubuntu archive keyring: good signature, Ubuntu Archive Automatic Signing Key2018, fingerprint F6ECB3762474EDA9D21B7022871920D1991BC93C. This proves the fetched metadata authenticity, not that the future CI runner's DNS will recover. No package installed on the user's host or local APT state changed.

References inspected:
- https://github.com/actions/runner-images/blob/main/images/ubuntu/scripts/build/configure-apt-sources.sh
- https://documentation.ubuntu.com/security/software-integrity/archive-verification/
- https://documentation.ubuntu.com/security/common-mistakes/deb-download-archive/
- https://archive.ubuntu.com/ubuntu/dists/noble-security/InRelease

Only a completed run on this branch will establish whether this narrower mirror selection fixes the observed CI dependency install. There are no chained retries or relaxed gates. Public repository, standard Ubuntu24.04 and Windows hosted runners, no added artifact uploads or paid runner shape.
