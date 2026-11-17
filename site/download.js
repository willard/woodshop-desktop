// Fills the download page from the latest GitHub release, and marks the visitor's system.
(() => {
    const repo = 'willard/woodshop-desktop';
    const kinds = [
        { os: 'mac', test: /\.dmg$/i, label: 'Disk image (.dmg)' },
        { os: 'windows', test: /-setup\.exe$/i, label: 'Installer (.exe)' },
        { os: 'windows', test: /\.msi$/i, label: 'Windows Installer (.msi)' },
        { os: 'linux', test: /\.AppImage$/i, label: 'AppImage' },
        { os: 'linux', test: /\.deb$/i, label: 'Debian / Ubuntu (.deb)' },
        { os: 'linux', test: /\.rpm$/i, label: 'Fedora / openSUSE (.rpm)' },
    ];
    const ua = navigator.userAgent;
    const mine = /Mac/.test(ua) ? 'mac' : /Win/.test(ua) ? 'windows' : /Linux/.test(ua) ? 'linux' : null;
    if (mine) document.querySelector(`[data-os="${mine}"]`)?.classList.add('yours');

    const size = (bytes) => `${(bytes / 1048576).toFixed(0)} MB`;
    fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json' },
    })
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((release) => {
            const date = new Date(release.published_at).toLocaleDateString(undefined, { dateStyle: 'long' });
            const line = document.getElementById('release');
            line.textContent = `Version ${release.tag_name.replace(/^v/, '')}, released ${date}. `;
            line.append(
                Object.assign(document.createElement('a'), {
                    href: release.html_url,
                    textContent: 'What’s new',
                }),
            );
            for (const asset of release.assets) {
                const kind = kinds.find((k) => k.test.test(asset.name));
                if (!kind) continue;
                const li = document.createElement('li');
                const a = Object.assign(document.createElement('a'), {
                    href: asset.browser_download_url,
                    textContent: kind.label,
                    className: 'button',
                });
                li.append(a, ` ${size(asset.size)}`);
                document.querySelector(`[data-os="${kind.os}"] [data-files]`).append(li);
            }
        })
        .catch((status) => {
            const line = document.getElementById('release');
            // 404: nothing published yet (a draft release doesn't count).
            const none = status === 404;
            line.textContent = none
                ? 'There is no release to download yet. Until there is, you can '
                : 'Couldn’t reach GitHub just now. ';
            line.append(
                Object.assign(document.createElement('a'), {
                    href: none
                        ? `https://github.com/${repo}/blob/main/CONTRIBUTING.md`
                        : `https://github.com/${repo}/releases`,
                    textContent: none ? 'build it from source' : 'See every release on GitHub',
                }),
                none ? '.' : '',
            );
        });
})();
