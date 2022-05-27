/// An axis label that appears on the edge of a diagram.
class Label {
    constructor(position, direction, text) {
        this.position = position;

        // We keep track of whether the label is selected or not, because we want different
        // behaviour when we click on a label for the first time and when we click on it a second
        // time.
        let was_selected;
        this.element = new DOM.Div({ class: "label" }).listen("mousedown", (event) => {
            // We always want clicking on a label to block the event from anything else underneath
            // the label, but only want the click to have an effect in the default mode.
            event.stopPropagation();
            if (state.in_mode(UIMode.Default)) {
                was_selected = false;
                if (event.button === 0) {
                    if (state.selected === this && document.activeElement !== state.input.element) {
                        was_selected = true;
                    } else {
                        // This activates the `<input>` but doesn't actually focus it due to event
                        // order. This is sufficient for our purposes, however.
                        state.focus_input(this);
                    }
                }
                if (event.button === 2) {
                    // We delete labels by right-clicking on them.
                    state.tangle.remove_label(this.position, direction);
                    this.element.remove();
                    // Hide the `<input>`.
                    state.focus_input(null);
                }
            }
        }).listen("mouseup", (event) => {
            event.stopPropagation();
            if (state.in_mode(UIMode.Default)) {
                if (event.button === 0) {
                    // When we create a `Label` from an `Anchor`, we want to focus the input
                    // immediately, hence the second condition.
                    if (was_selected || this.text.trim() === "") {
                        // Note the comment above about `focus_input`: the previous invocation did
                        // not actually focus the input, so we call it here on `mouseup` instead.
                        state.focus_input(this);
                    }
                }
            }
        });
        this.set_text(text);
    }

    /// Update the text of the label and render it with KaTeX.
    set_text(text) {
        this.text = text;
        // Render the label with KaTeX.
        // Currently all errors are disabled, so we don't wrap this in a try-catch block.
        state.KaTeX.then((katex) => {
            katex.render(
                this.text.replace(/\$/g, "\\$"),
                this.element.element,
                {
                    throwOnError: false,
                    errorColor: "hsl(0, 100%, 40%)",
                },
            );
        });
    }
}

/// A tile in the diagram. The main information recorded by a tile is its `template`, which
/// describes the actual appearance of the tile.
class Tile {
    constructor(state, template, position) {
        this.position = position;
        this.template = template;

        const [left, top] = [
            position.x * CONSTANTS.TILE_WIDTH - CONSTANTS.TILE_WIDTH / 2,
            position.y * CONSTANTS.TILE_HEIGHT - CONSTANTS.TILE_HEIGHT / 2,
        ];
        this.element = new DOM.Div({ class: "tile" }, {
            left: `${left}px`,
            top: `${top}px`,
        }).add(this.template.svg);

        // The anchors are the buttons that may be clicked to expand into a label.
        this.anchors = [];
        for (let i = 0; i < 4; ++i) {
            const offset = Tangle.adjacent_offset(i).scale(
                CONSTANTS.TILE_WIDTH / 2 + CONSTANTS.ANCHOR_OFFSET,
                CONSTANTS.TILE_HEIGHT / 2 + CONSTANTS.ANCHOR_OFFSET,
            );
            this.anchors.push(new DOM.Div({ class: `anchor ${["right", "bottom", "left", "top"][i]}` }, {
                left: `${CONSTANTS.TILE_WIDTH / 2 + offset.x}px`,
                top: `${CONSTANTS.TILE_HEIGHT / 2 + offset.y}px`,
            }).listen("mousedown", (event) => {
                if (event.button === 0) {
                    event.stopPropagation();
                    if (!this.anchors[i].query_selector(".label")) {
                        state.focus_input(this.set_label(i, ""));
                    }
                }
            }).add_to(this.element));
        }

        this.element.listen("mousedown", (event) => {
            if (event.button === 0) {
                if (state.in_mode(UIMode.Tile)) {
                    event.stopPropagation();
                    // If we click on a tile in `UIMode.Tile`, we replace this tile with the new
                    // one. For simplicity, we don't check whether the new tile is any different to
                    // the one we are replacing, as this should not make a difference to the
                    // diagram.
                    state.replace_tile(this.position, state.mode.get_template(state));
                }
                if (state.in_mode(UIMode.Colour)) {
                    event.stopPropagation();
                    // If we click on a tile in `UIMode.Colour`, we flood-fill the associated
                    // region.
                    const position = view.pointer_position(event).sub(new Point(left, top));
                    this.fill_quadrant(
                        this.template.quadrant_at_position(position),
                        state.mode.colour,
                    );
                }
            }
            // If we right-click on a tile, we delete it.
            if (event.button === 2) {
                event.stopPropagation();
                state.tangle.remove_tile(this);
            }
        });
    }

    /// Tile templates are divided into four subregions, i.e. quadrants. We may flood-fill any one of
    /// them individually (which may result in flood-filling the others, if they are connected).
    fill_quadrant(quadrant, colour) {
        // Get the region associated with the quadrant...
        const region = this.template.vertex_at(quadrant).region;
        // ...update its colour...
        region.colour = colour;
        // ...and effect the change.
        for (const vertex of region.vertices) {
            vertex.element.set_style({ fill: state.colours[colour] });
        }
    }

    /// Update an axis `Label` associated to a tile.
    set_label(direction, text) {
        const label = new Label(this.position, direction, text);
        this.anchors[direction].add(label.element);
        state.tangle.set_label(this.position, direction, label);
        switch ((direction + 1) % 4) {
            case 0:
                label.element.set_style({ bottom: 0, left: "50%", transform: "translateX(-50%)" });
                break;
            case 1:
                label.element.set_style({ left: 0, top: "50%", transform: "translateY(-50%)" });
                break;
            case 2:
                label.element.set_style({ top: 0, left: "50%", transform: "translateX(-50%)" });
                break;
            case 3:
                label.element.set_style({ right: 0, top: "50%", transform: "translateY(-50%)" });
                break;
        }
        return label;
    }
}

/// How an annotation is aligned with respect to a cell.
const ALIGNMENT = new Enum(
    "ALIGNMENT",
    // In the centre of a tile (e.g. a cell).
    "CENTRE",
    // At the edge of a tile (e.g. an arrow).
    "EDGE",
);

/// An element that is placed on top of a diagram (usually on top of a tile).
class Annotation {
    constructor(_tangle, position) {
        this.position = position;
    }
}

/// A cell typically represents a 2-cell, which is depicted as a circle (more generally, a rounded
/// rectangle) with a LaTeX label.
Annotation.Cell = class extends Annotation {
    constructor(tangle, position, { text = "", width = 0 }) {
        super(tangle, position);

        const [left, top] = [
            position.x * CONSTANTS.TILE_WIDTH - CONSTANTS.TILE_WIDTH / 2,
            position.y * CONSTANTS.TILE_HEIGHT - CONSTANTS.TILE_HEIGHT / 2,
        ];

        // Like `Label`s, we want different behaviour depending on whether we are first clicking on
        // a cell, or clicking a second time, so we need to track whether the cell was already
        // selected. This behaviour is essentially duplicated from `Label`: see the comments there
        // for more details.
        let was_selected;
        this.element = new DOM.Div({ class: "cell" }, {
            left: `${left}px`,
            top: `${top}px`,
        }).listen("mousedown", (event) => {
            if (state.in_mode(UIMode.Default, UIMode.Annotation)) {
                event.stopPropagation();
                was_selected = false;
                if (event.button === 0) {
                    if (state.selected === this && document.activeElement !== state.input.element) {
                        was_selected = true;
                    } else {
                        state.focus_input(this);
                    }
                }
                // Rick-clicking on a cell removes it.
                if (event.button === 2) {
                    tangle.remove_annotation(this);
                    // Hide the `<input>` and size input.
                    state.focus_input(null);
                }
            }
        }).listen("mouseup", (event) => {
            if (state.in_mode(UIMode.Default, UIMode.Annotation)) {
                if (event.button === 0) {
                    if (was_selected) {
                        state.focus_input(this);
                    }
                }
            }
        });
        this.set_text(text);
        this.set_width(width);
    }

    /// Update the text of the label and render it with KaTeX.
    set_text(text) {
        this.text = text;
        // Render the label with KaTeX.
        // Currently all errors are disabled, so we don't wrap this in a try-catch block.
        state.KaTeX.then((katex) => {
            katex.render(
                this.text.replace(/\$/g, "\\$"),
                this.element.element,
                {
                    throwOnError: false,
                    errorColor: "hsl(0, 100%, 40%)",
                },
            );
        });
    }

    /// Update the width of the cell.
    set_width(width) {
        this.width = width;
        this.element.set_style({ width: `${
            this.width * CONSTANTS.TILE_WIDTH + CONSTANTS.CELL_SIZE
        }px` });
    }

    export_tikz(origin) {
        return `\\tgCell${this.width > 0 ? `[${this.width}]` : ""}{(${
            this.position.x - 0.5 - origin.x
        },${
            this.position.y - 0.5 - origin.y
        })}{${this.text}}`;
    }
};

Annotation.Cell.alignment = ALIGNMENT.CENTRE;

/// An arrow is an annotation that depicts the orientation of a string (typically to give an
/// indication of how a string has been transformed by bending).
Annotation.Arrow = class extends Annotation {
    constructor(tangle, position, { flip = false }) {
        super(tangle, position);
        // The default orientation is right and down; `flip` controls where the arrow should be
        // flipped to face in the opposite direction.
        this.flip = flip;

        const [width, height] = [CONSTANTS.TILE_WIDTH / 2, CONSTANTS.TILE_HEIGHT / 2];
        const [left, top] = [
            position.x * CONSTANTS.TILE_WIDTH - CONSTANTS.TILE_WIDTH / 2,
            position.y * CONSTANTS.TILE_HEIGHT - CONSTANTS.TILE_HEIGHT / 2,
        ];
        this.svg = new DOM.SVGElement("svg", {
            width,
            height,
        });

        // `h` is true if the arrow is horizontal. We determine this based on the position of the
        // arrow, which will be aligned to an edge (either horizontal or vertical).
        const h = this.position.x % 1 === 0;

        // Determine the direction of the arrow (0 is right, 3 is up).
        this.direction = ((h ? 0 : 3) + (+this.flip * 2)) % 4;
        
        new DOM.SVGElement("path", {
            d: `M ${width / 2 + (2 * 4 ** 2) ** 0.5 / 2} ${height / 2} l -4 -4 m 4 4 l -4 4`,
            stroke: "black",
            fill: "none",
        }, {
            "stroke-linecap": "square",
        }).add_to(this.svg);
        this.svg.set_style({
            transform: `rotate(${this.direction / 4}turn)`,
        });

        this.element = new DOM.Div({ class: "annotation arrow" }, {
            left: `${left}px`,
            top: `${top}px`,
        }).add(this.svg).listen("mousedown", (event) => {
            if (state.in_mode(UIMode.Annotation)) {
                event.stopPropagation();
                // If we left-click on an arrow, we flip its direction.
                if (event.button === 0) {
                    this.flip = !this.flip;
                    this.direction = (this.direction + 2) % 4;
                    this.svg.set_style({
                        transform: `rotate(${this.direction / 4}turn)`,
                    });
                }
                // If we right-click on an arrow, we delete it.
                if (event.button === 2) {
                    tangle.remove_annotation(this);
                }
            }
        });
    }

    export_tikz(origin) {
        return `\\tgArrow{(${
            this.position.x - 0.5 - origin.x
        },${
            this.position.y - 0.5 - origin.y
        })}{${((3 - this.direction) + 1) % 4}}`;
    }
};

Annotation.Arrow.alignment = ALIGNMENT.EDGE;
