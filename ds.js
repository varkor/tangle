"use strict";

/// An enumeration type.
class Enum {
    constructor(name, ...variants) {
        for (const variant of variants) {
            this[variant] = Symbol(`${name}::${variant}`);
        }
    }
}

/// A quintessential 2D (x, y) point.
class Point {
    constructor(x, y) {
        [this.x, this.y] = [x, y];
    }

    static zero() {
        return new this(0, 0);
    }

    static lendir(length, direction) {
        return new this(Math.cos(direction) * length, Math.sin(direction) * length);
    }

    static diag(x) {
        return new this(x, x);
    }

    toString() {
        return `${this.x},${this.y}`;
    }

    toArray() {
        return [this.x, this.y];
    }

    px(comma = true) {
        return `${this.x}px${comma ? "," : ""} ${this.y}px`;
    }

    eq(other) {
        return this.x === other.x && this.y === other.y;
    }

    add(other) {
        return new (this.constructor)(this.x + other.x, this.y + other.y);
    }

    sub(other) {
        return new (this.constructor)(this.x - other.x, this.y - other.y);
    }

    neg() {
        return new (this.constructor)(-this.x, -this.y);
    }

    scale(w, h) {
        return new (this.constructor)(this.x * w, this.y * h);
    }

    inv_scale(w, h) {
        return new (this.constructor)(this.x / w, this.y / h);
    }

    mul(multiplier) {
        return this.scale(multiplier, multiplier);
    }

    div(divisor) {
        return this.inv_scale(divisor, divisor);
    }

    max(other) {
        return new (this.constructor)(Math.max(this.x, other.x), Math.max(this.y, other.y));
    }

    min(other) {
        return new (this.constructor)(Math.min(this.x, other.x), Math.min(this.y, other.y));
    }

    rotate(theta) {
        return new (this.constructor)(
            this.x * Math.cos(theta) - this.y * Math.sin(theta),
            this.y * Math.cos(theta) + this.x * Math.sin(theta),
        );
    }

    length() {
        return Math.hypot(this.y, this.x);
    }

    angle() {
        return Math.atan2(this.y, this.x);
    }

    lerp(other, t) {
        return this.add(other.sub(this).mul(t));
    }

    is_zero() {
        return this.x === 0 && this.y === 0;
    }
}

/// Returns a `Map` containing the current URL's query parameters.
function query_parameters(url = window.location.href) {
    const query_string = url.match(/\?(.*)$/);
    if (query_string !== null) {
        // If there is `q` parameter in the query string, try to decode it as a diagram.
        const query_segs = query_string[1].split("&");
        const query_data = new Map(query_segs.map(segment => segment.split("=")));
        return query_data;
    }
    return new Map();
}
