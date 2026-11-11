// cabinet: a small tween helper in place of GSAP (D233), so everything teti ships
// on the cabinet is open source and the Studio can change it freely.
//
// It covers exactly what teti uses, with GSAP's names so teti's call sites stay
// as they were: gsap.to / gsap.timeline (.to .set .add .kill .pause .play
// .totalProgress) / gsap.killTweensOf; positions as absolute seconds; duration,
// ease, repeat (-1 = forever), yoyo, stagger, paused, onComplete; Pixi
// properties under `pixi` (alpha, x, y, scale, scaleX, scaleY, rotation in
// degrees, tint, width, height, pivotX, pivotY); CSS x, y (with units) and
// opacity on elements or selectors; power1-3, none/linear, bounce.out and
// CustomEase cubic-beziers.
//
// A classic script (not a module): it sets window.gsap, PixiPlugin and CustomEase.
(() => {
    // ---------- eases ----------
    const pow = (n) => ({ in: (p) => p ** n, out: (p) => 1 - (1 - p) ** n, inOut: (p) => (p < 0.5 ? (2 * p) ** n / 2 : 1 - (2 - 2 * p) ** n / 2) });
    const bounceOut = (p) => {
        const n = 7.5625, d = 2.75;
        if (p < 1 / d) return n * p * p;
        if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75;
        if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375;
        return n * (p -= 2.625 / d) * p + 0.984375;
    };
    const EASES = { none: (p) => p, linear: (p) => p, "bounce.out": bounceOut, "bounce.in": (p) => 1 - bounceOut(1 - p) };
    [1, 2, 3, 4].forEach((n) => Object.entries(pow(n + 1)).forEach(([k, f]) => (EASES[`power${n}.${k}`] = f)));
    ["1", "2", "3", "4"].forEach((n) => (EASES[`power${n}`] = EASES[`power${n}.out`]));

    /** A CSS-style cubic-bezier through (0,0), (x1,y1), (x2,y2), (1,1). */
    function bezier(x1, y1, x2, y2) {
        const at = (a, b, t) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
        return (p) => {
            let lo = 0, hi = 1, t = p;
            for (let i = 0; i < 30; i++) { // bisection on x
                const x = at(x1, x2, t);
                if (Math.abs(x - p) < 1e-5) break;
                if (x < p) lo = t; else hi = t;
                t = (lo + hi) / 2;
            }
            return at(y1, y2, t);
        };
    }
    const easeOf = (e) => (typeof e === "function" ? e : EASES[e ?? "power1.out"] ?? EASES["power1.out"]);

    // ---------- values ----------
    const probe = document.createElement("canvas").getContext("2d");
    /** A colour (name, #hex, number, or "none" for no tint) as [r, g, b]. */
    function rgb(c) {
        if (c === "none" || c == null) return [255, 255, 255];
        if (typeof c === "number") return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
        if (typeof c === "object" && "toNumber" in c) return rgb(c.toNumber());
        probe.fillStyle = "#000";
        probe.fillStyle = String(c);
        const h = probe.fillStyle; // "#rrggbb" or "rgba(...)"
        if (h[0] === "#") return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
        return h.match(/\d+/g).slice(0, 3).map(Number);
    }
    const isEl = (t) => typeof Element !== "undefined" && t instanceof Element;

    /** How to read and write one property on one target. */
    function accessor(target, key, pixi) {
        if (pixi) {
            switch (key) {
                case "scale": return { get: () => target.scale.x, set: (v) => target.scale.set(v) };
                case "scaleX": return { get: () => target.scale.x, set: (v) => (target.scale.x = v) };
                case "scaleY": return { get: () => target.scale.y, set: (v) => (target.scale.y = v) };
                case "rotation": return { get: () => target.angle, set: (v) => (target.angle = v) };
                case "pivotX": return { get: () => target.pivot.x, set: (v) => (target.pivot.x = v) };
                case "pivotY": return { get: () => target.pivot.y, set: (v) => (target.pivot.y = v) };
                case "tint": return { get: () => target.tint, set: (v) => (target.tint = v), colour: true };
                default: return { get: () => target[key], set: (v) => (target[key] = v) };
            }
        }
        if (isEl(target)) {
            const st = (target.__tween ??= { x: 0, y: 0, ux: "px", uy: "px" });
            const transform = () => (target.style.transform = `translate(${st.x}${st.ux}, ${st.y}${st.uy})`);
            if (key === "x" || key === "y") return { get: () => st[key], set: (v) => ((st[key] = v), transform()), unit: (u) => (st[`u${key}`] = u) };
            if (key === "opacity") return { get: () => Number(getComputedStyle(target).opacity), set: (v) => (target.style.opacity = String(v)) };
            return { get: () => parseFloat(getComputedStyle(target)[key]) || 0, set: (v) => (target.style[key] = `${v}px`) };
        }
        return { get: () => target[key], set: (v) => (target[key] = v) };
    }

    const RESERVED = new Set(["duration", "ease", "repeat", "yoyo", "stagger", "paused", "onComplete", "immediateRender", "pixi", "delay"]);

    function targetsOf(t) {
        if (typeof t === "string") return [...document.querySelectorAll(t)];
        if (Array.isArray(t)) return t.flatMap(targetsOf);
        if (typeof NodeList !== "undefined" && t instanceof NodeList) return [...t];
        return t ? [t] : [];
    }

    const live = new Set(); // every tween not yet killed, for killTweensOf

    // ---------- tweens ----------
    class Tween {
        constructor(targets, vars) {
            this.targets = targetsOf(targets);
            this.vars = vars;
            this.dur = Math.max(0, vars.duration ?? 0.5);
            this.repeat = vars.repeat ?? 0;
            this.ease = easeOf(vars.ease);
            const s = vars.stagger ?? 0;
            const n = this.targets.length;
            this.offsets = this.targets.map((_, i) => (s >= 0 ? i * s : (n - 1 - i) * -s));
            this.iterDur = this.dur;
            this.duration = this.repeat < 0 ? Infinity : this.dur * (this.repeat + 1) + Math.max(0, ...this.offsets, 0);
            this.props = null; // per target, captured on first render
            this.dead = false;
            live.add(this);
        }
        /** Build the per-target from/to list, from the targets as they are now. */
        capture() {
            const list = [];
            const add = (target, key, to, pixi) => {
                const a = accessor(target, key, pixi);
                if (a.colour) return list.push({ a, from: rgb(a.get()), to: rgb(to), colour: true });
                let end = to, unit = null;
                if (typeof to === "string") {
                    const m = /^(-?[\d.]+)([a-z%]*)$/.exec(to.trim());
                    end = m ? Number(m[1]) : Number(to);
                    unit = m && m[2] ? m[2] : null;
                    if (unit && a.unit) a.unit(unit);
                }
                list.push({ a, from: Number(a.get()) || 0, to: end });
            };
            this.props = this.targets.map((target) => {
                list.length = 0;
                for (const [k, v] of Object.entries(this.vars.pixi ?? {})) add(target, k, v, true);
                for (const [k, v] of Object.entries(this.vars)) if (!RESERVED.has(k)) add(target, k, v, false);
                return [...list];
            });
        }
        /** Draw the tween at local time t (seconds from its start). */
        render(t) {
            if (this.dead) return;
            if (!this.props) this.capture();
            this.targets.forEach((_, i) => {
                const lt = t - this.offsets[i];
                if (lt < 0) return;
                let p;
                if (this.dur === 0) p = 1;
                else {
                    const total = this.repeat < 0 ? Infinity : this.dur * (this.repeat + 1);
                    const tt = Math.min(lt, total);
                    let iter = Math.floor(tt / this.dur);
                    let local = tt - iter * this.dur;
                    if (tt >= total) { iter = this.repeat; local = this.dur; }
                    p = local / this.dur;
                    if (this.vars.yoyo && iter % 2 === 1) p = 1 - p;
                }
                const e = this.ease(Math.min(1, Math.max(0, p)));
                for (const pr of this.props[i]) {
                    if (pr.colour) {
                        const c = pr.from.map((f, k) => Math.round(f + (pr.to[k] - f) * e));
                        pr.a.set((c[0] << 16) | (c[1] << 8) | c[2]);
                    } else pr.a.set(pr.from + (pr.to - pr.from) * e);
                }
            });
        }
        kill() {
            this.dead = true;
            live.delete(this);
        }
    }

    // ---------- timelines (and the root clock) ----------
    const running = new Set();
    let last = 0;
    function tick(now) {
        const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
        last = now;
        for (const a of [...running]) a.advance(dt);
        requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);

    class Timeline {
        constructor(vars = {}) {
            this.vars = vars;
            this.children = []; // { start, tween?, fn?, done? }
            this.time = 0;
            this.end = 0;
            this.paused = !!vars.paused;
            this.finished = false;
            this.dead = false;
            running.add(this);
        }
        get duration() {
            return this.children.reduce((m, c) => Math.max(m, c.start + (c.tween ? c.tween.duration : 0)), 0);
        }
        at(position) {
            if (position === undefined) return this.end;
            const n = Number(position);
            return Number.isFinite(n) ? n : this.end;
        }
        to(targets, vars, position) {
            const tween = new Tween(targets, vars);
            const start = this.at(position) + (vars.delay ?? 0);
            this.children.push({ start, tween });
            this.end = Math.max(this.end, start + tween.duration);
            this.finished = false;
            if (vars.immediateRender && start <= this.time) tween.render(this.time - start);
            return this;
        }
        set(targets, vars, position) {
            return this.to(targets, { ...vars, duration: 0, immediateRender: vars.immediateRender ?? true }, position);
        }
        add(fn, position) {
            this.children.push({ start: this.at(position), fn });
            return this;
        }
        render() {
            for (const c of this.children) {
                if (this.time < c.start) continue;
                if (c.fn) {
                    if (!c.done) { c.done = true; c.fn(); }
                } else if (this.time - c.start >= c.tween.duration) {
                    // Finished: draw its last state once, then leave the properties alone.
                    if (!c.done) { c.done = true; c.tween.render(c.tween.duration); }
                } else c.tween.render(this.time - c.start);
            }
        }
        advance(dt) {
            if (this.dead || this.paused) return;
            this.time += dt;
            this.render();
            const d = this.duration;
            if (!this.finished && this.time >= d && d !== Infinity) {
                this.finished = true;
                running.delete(this);
                this.vars.onComplete?.();
            }
        }
        totalProgress(p) {
            const d = this.duration;
            if (d === Infinity) return this;
            this.time = d * p;
            this.render();
            if (p >= 1 && !this.finished) {
                this.finished = true;
                running.delete(this);
                this.vars.onComplete?.();
            }
            return this;
        }
        pause() { this.paused = true; return this; }
        play() {
            this.paused = false;
            if (!this.dead && !this.finished) running.add(this);
            return this;
        }
        kill() {
            this.dead = true;
            running.delete(this);
            for (const c of this.children) c.tween?.kill();
            return this;
        }
    }

    window.gsap = {
        timeline: (vars) => new Timeline(vars),
        /** A lone tween: a timeline of one. */
        to: (targets, vars) => new Timeline({ onComplete: vars.onComplete, paused: vars.paused }).to(targets, { ...vars, onComplete: undefined }, 0),
        killTweensOf(target) {
            for (const t of [...live]) if (t.targets.includes(target)) t.kill();
        },
        registerPlugin() {},
    };
    window.PixiPlugin = { registerPIXI() {} };
    window.CustomEase = {
        create(name, spec) {
            const [x1, y1, x2, y2] = String(spec).split(/[\s,]+/).filter(Boolean).map(Number);
            EASES[name] = bezier(x1, y1, x2, y2);
        },
    };
})();
