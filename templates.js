"use strict";

/// Constants determining visual aspects of the diagram.
const CONSTANTS = {
    TILE_WIDTH: 64,
    TILE_HEIGHT: 64,
};

/// A template describes the style of a tile, e.g. a corner, a curve, etc.
class Template {
    constructor() {
        this.svg = new DOM.SVGElement("svg", {
            width: CONSTANTS.TILE_WIDTH,
            height: CONSTANTS.TILE_HEIGHT,
        });
    }

    // Returns the TikZ colour associated to the vertex.
    static tikz_colour(vertex) {
        const region = vertex.region;
        return region.colour !== null ? `\\tgColour${region.colour}` : "white";
    }

    /// Returns every vertex associated to the tile. There may be up to four vertices, but
    /// potentially less. E.g. the blank tile only has a single vertex, because there is only one
    /// colour associated to a blank tile.
    all_vertices() {
        const vertices = new Set();
        for (let i = 0; i < 4; ++i) {
            vertices.add(this.vertex_at(i));
        }
        return vertices;
    }

    /// Each template has four associated vertex positions: top-left (0), top-right (1),
    /// bottom-right (2), bottom-left (3). There may not necessarily be four unique vertices, but we
    /// can always query which colour the vertex corresponding to that position has. This function
    /// returns the quadrant (0 to 3) associated to `position`.
    quadrant_at_position(position) {
        const centre = new Point(CONSTANTS.TILE_WIDTH / 2, CONSTANTS.TILE_HEIGHT / 2);
        return Math.floor(2 * position.sub(centre).angle() / Math.PI) + 2;
    }
}

/// A blank tile, with a single colour fill.
Template.Blank = class extends Template {
    constructor(state, _parameters, abstract) {
        super();

        const rect = new DOM.SVGElement("rect", {
            width: CONSTANTS.TILE_WIDTH,
            height: CONSTANTS.TILE_HEIGHT,
        }, {
            fill: "transparent",
        });
        this.svg.add(rect);

        this.vertex = null;
        // `abstract` will be true if the template is being used for its SVG only and is not part of
        // the diagram.
        if (!abstract) {
            this.vertex = state.region_graph.add_vertex(rect);
        }
    }

    vertex_at(_direction) {
        return this.vertex;
    }

    export_tikz(position) {
        return `\\tgBlank{(${position})}{${Template.tikz_colour(this.vertex)}}`;
    }
};

/// A tile with + borders (each of which can be toggled on/off).
Template.Border = class extends Template {
    constructor(state, borders, abstract) {
        super();
        // [top, right, bottom, left]
        this.borders = borders;

        this.vertices = [];

        // Add the regions in each corner of the tile.
        for (let direction = 0; direction < 4; ++direction) {
            const position = new Point(1, 1).add([
                new Point(-1, -1), new Point(1, -1), new Point(1, 1), new Point(-1, 1)
            ][direction]).scale(CONSTANTS.TILE_WIDTH / 4, CONSTANTS.TILE_HEIGHT / 4);
            const rect = new DOM.SVGElement("rect", {
                x: position.x,
                y: position.y,
                width: CONSTANTS.TILE_WIDTH / 2,
                height: CONSTANTS.TILE_HEIGHT / 2,
            }, {
                fill: "transparent",
            }).add_to(this.svg);

            if (!abstract) {
                const vertex = state.region_graph.add_vertex(rect);
                this.vertices.push(vertex);
            }
        }

        // Connect those internal subregions that are not separated by a border.
        if (!abstract) {
            for (let direction = 0; direction < 4; ++direction) {
                if (!this.borders[direction]) {
                    state.region_graph.connect(
                        this.vertices[direction],
                        this.vertices[(direction + 1) % 4],
                    );
                }
            }
        }

        // Add the centre of the border, so that we get a square cap. We expect at least one border,
        // since otherwise `Blank` would be used.
        this.svg.add(new DOM.SVGElement("line", {
            x1: CONSTANTS.TILE_WIDTH / 2,
            y1: CONSTANTS.TILE_HEIGHT / 2,
            x2: CONSTANTS.TILE_WIDTH / 2,
            y2: CONSTANTS.TILE_HEIGHT / 2,
            stroke: "var(--stroke)",
        }, {
            "stroke-linecap": "square",
        }));

        // Add the borders themselves.
        for (let direction = 0; direction < 4; ++direction) {
            if (this.borders[(direction + 1) % 4]) {
                const adjacent_position = Tangle.adjacent_offset(direction)
                    .scale(CONSTANTS.TILE_WIDTH / 2, CONSTANTS.TILE_HEIGHT / 2);
                this.svg.add(new DOM.SVGElement("line", {
                    x1: CONSTANTS.TILE_WIDTH / 2,
                    y1: CONSTANTS.TILE_HEIGHT / 2,
                    x2: CONSTANTS.TILE_WIDTH / 2 + adjacent_position.x,
                    y2: CONSTANTS.TILE_HEIGHT / 2 + adjacent_position.y,
                    stroke: "var(--stroke)",
                }));
            }
        }
    }

    vertex_at(direction) {
        return this.vertices[direction];
    }

    export_tikz(position) {
        let output = "";
        // Get the colours associated to each subregion of the tile.
        const colours = this.vertices.map((vertex) => Template.tikz_colour(vertex));
        output += `\\tgBorderA{(${position})}${
            colours.map((colour) => `{${colour}}`).join("")
        }`;
        // Add the borders (where necessary, i.e. when there is a border separating two subregions
        // of the same colour, since a border won't be added automatically in this case).
        const borders = this.borders.map((border, i) => {
            return border && colours[i] === colours[(i + 1) % 4];
        });
        if (borders.some((border) => border)) {
            output += `\n\t\\tgBorder{(${position})}${
                borders.map((border) => `{${+border}}`).join("")
            }`;
        }
        return output;
    }
};

/// A curved corner.
Template.BorderCurve = class extends Template {
    constructor(state, parameters, abstract) {
        super();

        [this.direction] = parameters;

        const inner = new DOM.SVGElement("path", {
            d: `M ${CONSTANTS.TILE_WIDTH / 2} 0 a ${CONSTANTS.TILE_WIDTH / 2} ${CONSTANTS.TILE_HEIGHT / 2} 0 0 0 ${CONSTANTS.TILE_WIDTH / 2} ${CONSTANTS.TILE_HEIGHT / 2} v ${-CONSTANTS.TILE_HEIGHT / 2} z`,
            fill: "transparent",
        }).add_to(this.svg);
        const outer = new DOM.SVGElement("path", {
            d: `M 0 0 l ${CONSTANTS.TILE_WIDTH / 2} 0 a ${CONSTANTS.TILE_WIDTH / 2} ${CONSTANTS.TILE_HEIGHT / 2} 0 0 0 ${CONSTANTS.TILE_WIDTH / 2} ${CONSTANTS.TILE_HEIGHT / 2} v ${CONSTANTS.TILE_HEIGHT / 2} h ${-CONSTANTS.TILE_WIDTH} z`,
            fill: "transparent",
        }).add_to(this.svg);
        this.svg.add(new DOM.SVGElement("path", {
            d: `M ${CONSTANTS.TILE_WIDTH / 2} 0 a ${CONSTANTS.TILE_WIDTH / 2} ${CONSTANTS.TILE_HEIGHT / 2} 0 0 0 ${CONSTANTS.TILE_WIDTH / 2} ${CONSTANTS.TILE_HEIGHT / 2}`,
            stroke: "var(--stroke)",
            fill: "none",
        }));
        this.svg.set_style({
            transform: `rotate(${((this.direction + 3) % 4) / 4}turn)`,
        });

        // There are two vertices: a vertex for the interior of the curved region, and a vertex for
        // the exterior.
        this.vertex_inner = null;
        this.vertex_outer = null;
        if (!abstract) {
            this.vertex_inner = state.region_graph.add_vertex(inner);
            this.vertex_outer = state.region_graph.add_vertex(outer);
        }
    }

    vertex_at(direction) {
        return direction === this.direction ? this.vertex_inner : this.vertex_outer;
    }

    quadrant_at_position(position) {
        const quadrant = super.quadrant_at_position(position);
        // If the quadrant the user clicked in is the one with the curve, we have to put in a little
        // more effort to check whether it is on the interior or exterior.
        if (quadrant === this.direction) {
            let corner;
            switch (this.direction) {
                case 0:
                    corner = new Point(0, 0);
                    break;
                case 1:
                    corner = new Point(CONSTANTS.TILE_WIDTH, 0);
                    break;
                case 2:
                    corner = new Point(CONSTANTS.TILE_WIDTH, CONSTANTS.TILE_HEIGHT);
                    break;
                case 3:
                    corner = new Point(0, CONSTANTS.TILE_HEIGHT);
                    break;
            }
            if (position.sub(corner).length() > CONSTANTS.TILE_WIDTH / 2) {
                // All other quadrants share a region, so it doesn't matter which we pick, as long
                // as it is not `this.direction`.
                return 3 - this.direction;
            }
        }
        return quadrant;
    }

    export_tikz(position) {
        // The direction we calculate here is a little awkward, because TikZ angles are
        // anticlockwise, whereas JavaScript's are clockwise, and their 0° is different.
        return `\\tgBorderC{(${position})}{${((3 - this.direction) + 2) % 4}}{${
            Template.tikz_colour(this.vertex_outer)
        }}{${
            Template.tikz_colour(this.vertex_inner)
        }}`;
    }
};
