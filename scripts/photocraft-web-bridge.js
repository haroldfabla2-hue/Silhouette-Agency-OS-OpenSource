/* Silhouette <-> PhotoCraft web bridge (same-origin, session-auth inherited).
 * 1. SAVE: intercepts the editor's blob downloads and also writes them to the
 *    Silhouette workspace via POST /v1/visual/import (local download still happens).
 * 2. OPEN: listens for {type:'silhouette:open', name, url} postMessage from the
 *    dashboard, fetches the workspace file and drops it onto the editor canvas.
 * Reports back to the dashboard via postMessage. */
(function () {
    var origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
        var a = this;
        try {
            if (a.download && a.href && a.href.indexOf('blob:') === 0) {
                var name = a.download;
                fetch(a.href).then(function (r) { return r.blob(); }).then(function (blob) {
                    return fetch('/v1/visual/import', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/octet-stream', 'X-Visual-Filename': name },
                        body: blob
                    });
                }).then(function (r) {
                    window.parent.postMessage(r.ok
                        ? { type: 'silhouette:saved', name: name }
                        : { type: 'silhouette:save-error', name: name }, '*');
                }).catch(function () {
                    window.parent.postMessage({ type: 'silhouette:save-error', name: name }, '*');
                });
            }
        } catch (e) { /* never block the editor */ }
        return origClick.apply(this, arguments);
    };

    window.addEventListener('message', function (ev) {
        var d = ev.data || {};
        if (d.type !== 'silhouette:open' || !d.url || !d.name) return;
        fetch(d.url).then(function (r) {
            if (!r.ok) throw new Error('fetch ' + r.status);
            return r.blob();
        }).then(function (blob) {
            var file = new File([blob], d.name);
            var dt = new DataTransfer();
            dt.items.add(file);
            var canvas = document.querySelector('canvas');
            if (!canvas) throw new Error('no canvas');
            ['dragenter', 'dragover', 'drop'].forEach(function (type) {
                canvas.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
            });
            window.parent.postMessage({ type: 'silhouette:opened', name: d.name }, '*');
        }).catch(function () {
            window.parent.postMessage({ type: 'silhouette:open-error', name: d.name }, '*');
        });
    });
})();
