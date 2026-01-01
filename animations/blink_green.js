// Copyright (c) 2025 Philip Huppert. Licensed under the MIT License.

const params = {
    colorGroup: {
        group: 'Color',
        fgColor: { type: 'color', name: 'Foreground Color', default: [0.0, 1.0, 0.0] },
        bgColor: { type: 'color', name: 'Background Color', default: [0.0, 0.0, 0.0] },
    },

    animationGroup: {
        group: 'Animation',
        count: { type: 'int', name: 'Count', min: 0, max: 1200, default: 5 },
        speed: { type: 'float', name: 'Speed', min: 0.0, max: 5.0, default: 1.0 }
    },
};

function getSphereColor(x, y, z, t, params, id) {
    const fgColor = params.fgColor ?? [1.0, 0.0, 0.0];
    const bgColor = params.bgColor ?? [0.0, 0.0, 0.0];
    const count = params.count ?? 1;
    const speed = params.speed ?? 1.0;

    let e = (Math.floor(speed != 0 ? t / speed : 0.0) % 2) * (id < count ? 1 : 0);
    return e == 1 ? fgColor : bgColor;
}
