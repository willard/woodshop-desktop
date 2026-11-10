// Mirrors lib/theme.ts: an explicit stored choice wins, otherwise follow the OS.
(function () {
    var theme = 'dark';
    try {
        var stored = localStorage.getItem('woodshop.theme');
        if (stored === 'dark' || stored === 'light') theme = stored;
        else if (matchMedia('(prefers-color-scheme: light)').matches) theme = 'light';
    } catch (e) {}
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.height = '100%';
})();
