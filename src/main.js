"use strict";

Object.assign(CONSTANTS, {
    /// Half the width/height of an `.anchor`.
    ANCHOR_OFFSET: 8,
    /// The width of a single-column cell in pixels.
    CELL_SIZE: 32,
});

/// Various states for the UI (e.g. whether we are placing tiles, placing annotations,
/// flood-filling, etc.).
class UIMode {
    constructor() {
        // Used for the CSS class associated with the mode. `null` means no class.
        this.name = null;
    }

    /// A placeholder method to clean up any state when a mode is left.
    release() {}
}

/// The default mode, representing no special action.
UIMode.Default = class extends UIMode {
    constructor() {
        super();

        this.name = "default";
    }
};
UIMode.default = new UIMode.Default();

UIMode.Tool = class extends UIMode {
    release(state) {
        state.element.query_selector_all("#tools .selected").forEach((selected) => {
            selected.class_list.remove("selected");
        });
    }
}

UIMode.Tile = class extends UIMode.Tool {
    constructor(template, parameters) {
        super();

        this.name = "tile";

        // Which `Template` the tile should have.
        this.template = template;
        // What parameters to pass to the contructor of the template (e.g. which borders should be
        // drawn).
        this.parameters = parameters;
    }

    get_template(state) {
        return new this.template(state, this.parameters);
    }
};

UIMode.Annotation = class extends UIMode.Tool {
    constructor(type) {
        super();

        this.name = "annotation";

        this.type = type;
    }
};

UIMode.Colour = class extends UIMode.Tool {
    constructor(colour) {
        super();

        this.name = "colour";

        // The colour we have currently selected (an index for `state.colours`).
        this.colour = colour;
    }
};


/// The `state` is responsible for the UI state: keeping track of the string diagram, the active UI
/// elements, and so on.
const state = {
    // The element that `state` is responsible for: for now this is the document body.
    element: null,
    // The data structure for the diagram.
    tangle: new Tangle(),
    // The data structure for how the regions of the diagram connect to one another, used for
    // flood-filling.
    region_graph: new RegionGraph(),
    // The `UIMode` the UI is in (e.g. placing tiles, flood-filling, etc.).
    mode: null,
    // The list of colours in the colour palette (declared via the query string, or populated with
    // defaults).
    colours: [],
    // How many elements of `colours` were provided in the query string (the rest were filled with
    // defaults) to ensure that the remaining regions of the loaded diagram would be distinguished.
    saved_colours: 0,
    // The element that is currently focused (e.g. a cell).
    selected: null,
    // A convenience variable for accessing the `<input>` element used for inputting labels.
    input: null,
    // The KaTeX instance used to render LaTeX.
    KaTeX: null,

    /// Transitions to a `UIMode`.
    switch_mode(mode) {
        if (this.mode !== null) {
            // Clean up any state for which this mode is responsible.
            this.mode.release(this);
            if (this.mode.name !== null) {
                this.element.class_list.remove(`mode-${this.mode.name}`);
            }
        }
        this.mode = mode;
        if (this.mode.name !== null) {
            this.element.class_list.add(`mode-${this.mode.name}`);
        }
    },

    /// Returns whether the UI is in a particular mode.
    in_mode(...modes) {
        for (const mode of modes) {
            if (this.mode instanceof mode) {
                return true;
            }
        }
        return false;
    },

    /// Select a particular element (e.g. a cell) and open the `<input>` to edit it. If `on` is
    /// `null`, everything is deselected.
    focus_input(on) {
        this.selected = on;
        // Deselect any selected elements.
        this.element.query_selector_all("#canvas .selected").forEach((selected) => {
            selected.class_list.remove("selected");
        });
        if (on !== null) {
            // Select the element.
            on.element.class_list.add("selected");
            // Display the `<input>`.
            this.input.parent.class_list.remove("hidden");
            const input = this.input.element;
            input.value = on.text;
            input.focus();
            input.setSelectionRange(0, input.value.length);
            if (on instanceof Annotation.Cell) {
                // If we're focusing on a cell, we want to move the size input to the correct
                // position and display it. At present, there is a single global size input, so we
                // need to move that to the correct position and reveal it.
                const size_input = this.element.query_selector(".size-input");
                size_input.class_list.remove("hidden");
                const [left, top] = [
                    on.position.x * CONSTANTS.TILE_WIDTH - CONSTANTS.TILE_WIDTH / 2,
                    on.position.y * CONSTANTS.TILE_HEIGHT - CONSTANTS.TILE_HEIGHT / 2,
                ];
                size_input.set_style({
                    left: `${left}px`,
                    top: `${top}px`,
                });
                // We should not be able to change the width of a cell to a negative integer.
                size_input.query_selector("button").element.disabled =
                    this.selected.width === 0;
            }
        } else {
            // Hide the `<input>`.
            this.input.parent.class_list.add("hidden");
            this.element.query_selector_all(".size-input").forEach((size_input) => {
                size_input.class_list.add("hidden");
            });
        }
    },

    /// Replaces a tile at the given `position` with a new tile. This is slightly different from
    /// removing the existing tile and adding a new one, as we want to preserve certain properties
    /// that would otherwise be loss, such as colours and labels.
    replace_tile(position, template) {
        // We record the colours of the current tile in each of its corners (should colours have
        // been assigned). When we place the new tile, we will floodfill each of its colours with
        // these colours to preserve the colour information.
        let prev_colours = [null, null, null, null];
        // And similarly for labels.
        let prev_labels = [null, null, null, null];
        // This method is not expected to necessarily be called with a tile present at `position`,
        // so we must check whether there is a tile present. We then assign `prev_colours` and
        // `prev_labels` accordingly.
        if (this.tangle.tiles.has(`${position}`)) {
            const prev_tile = this.tangle.tiles.get(`${position}`);
            prev_colours = [0, 1, 2, 3].map((i) => prev_tile.template.vertex_at(i).region.colour);
            // `tangle.labels` is only assigned for a particular position if the tile has any
            // labels, so we need to check it exists.
            if (this.tangle.labels.has(`${position}`)) {
                prev_labels = this.tangle.labels.get(`${position}`);
            }
            this.tangle.remove_tile(prev_tile, false);
        }
        // Create the new tile.
        const tile = this.tangle.add_tile(this, template, position);
        // Update colour based on both the neighbours and the previous colours. Ideally,
        // `prev_colours` will always match the colours of the neighbours, but this may not be true
        // if this method is called for a position where there isn't currently a tile, so we check
        // the neighbours first. However, colour may not be recoverable from neighbours (if there
        // aren't neighbours on some sides), which is where `prev_colours` is useful. This will also
        // floodfill neighbours that are now incompatible to make them compatible (e.g. if we had X
        // O X, where the two X's were previously disconnected by an O with a border, but the new
        // tile connects the two, we need now to make the two X's share a colour region).
        for (let i = 0; i < 4; ++i) {
            const region = tile.template.vertex_at(i).region;
            const colour = region.colour !== null ? region.colour : prev_colours[i];
            tile.fill_quadrant(i, colour);
        }
        // Add back any previous labels.
        prev_labels.forEach((label, i) => {
            if (label !== null) {
                tile.set_label(i, label.text);
            }
        });
        // Add the tile to the body.
        tile.element.add_to(this.element.query_selector("#canvas"));
    },

    // A helper method for displaying error banners.
    display_error(message) {
        // If there's already an error, it's not unlikely that subsequent errors will be triggered.
        // Thus, we don't display an error banner if one is already displayed.
        if (this.element.query_selector(".error-banner:not(.hidden)") === null) {
            const error = new DOM.Div({ class: "error-banner hidden" })
                .add(message)
                .add(
                    new DOM.Element("button", { class: "close" })
                        .listen("click", () => this.dismiss_error())
                );
            this.element.add(error);
            // Animate the banner's entry.
            delay(() => error.class_list.remove("hidden"));
        }
    },

    /// A helper method for dismissing error banners.
    /// Returns whether there was any banner to dismiss.
    dismiss_error() {
        const error = this.element.query_selector(".error-banner");
        if (error) {
            const SECOND = 1000;
            error.class_list.add("hidden");
            setTimeout(() => error.remove(), 0.2 * SECOND);
            return true;
        }
        return false;
    },
};

/// The `view` is responsible for handling the panning and zooming of the diagram.
const view = {
    // The `position` is the centre of the view.
    position: Point.zero(),
    // The `scale` is based on a logarithmic scale. I.e. 0 is default, 1 is twice as large, -1 is
    // half as large, and so on.
    scale: 0,
    // The element that may be moved and scaled, containing the diagram.
    canvas: null,

    /// Repositions the view by an absolute offset.
    pan_to(position, scale = this.scale) {
        this.position = position;
        this.scale = scale;
        const scaled_position = this.position.mul(2 ** this.scale).neg();
        this.canvas.set_style({
            transform: `translate(${scaled_position.px()}) scale(${2 ** this.scale})`,
        });
    },

    /// Repositions the view by a relative offset.
    /// If `offset` is positive, then everything will appear to move towards the top left.
    /// If `zoom` is positive, then everything will grow larger.
    pan_by(offset, scale = 0) {
        this.pan_to(this.position.add(offset), this.scale + scale);
    },

    /// Centre the view on the diagram.
    centre(tangle) {
        const { origin, coorigin } = tangle.dimensions();
        this.pan_to(origin.add(coorigin).div(2).scale(CONSTANTS.TILE_WIDTH, CONSTANTS.TILE_HEIGHT));
    },

    /// Returns the position of a pointer event taking into account the view offset.
    pointer_position(event) {
        return new Point(
            event.clientX + view.position.x - document.body.offsetWidth / 2,
            event.clientY + view.position.y - document.body.offsetHeight / 2,
        );
    }
};

// This is where we instantiate all the various UI components.
document.addEventListener("DOMContentLoaded", () => {
    // Instantiate `state`.
    const body = new DOM.Element(document.body);
    state.element = body;
    state.switch_mode(UIMode.default);

    // Set up the element containing all the cells.
    const container = new DOM.Div({ id: "container" }).add_to(body.element);
    // `canvas`, which lies within `container`, may be moved around and scaled according to the
    // `view.
    const canvas = new DOM.Div({ id: "canvas" }).add_to(container);
    view.canvas = canvas;
    // Handle panning via scrolling.
    window.addEventListener("wheel", (event) => {
        // We don't want to scroll the page itself while using the mouse wheel.
        event.preventDefault();

        view.pan_by(new Point(
            event.deltaX * 2 ** -view.scale,
            event.deltaY * 2 ** -view.scale,
        ));
    }, { passive: false });

    // The size input is the UI element that allows us to change the size of a cell. For simplicity,
    // we create a global size input and move it around accordingly.
    const size_input = new DOM.Div({
        class: "size-input hidden",
    });
    size_input.listen("mousedown", (event) => event.stopPropagation());
    // The "-" button.
    const smaller = new DOM.Element("button").add("-").listen("mousedown", (event) => {
        if (event.button === 0) {
            state.selected.set_width(Math.max(0, state.selected.width - 1));
            smaller.element.disabled = state.selected.width === 0;
        }
    }).add_to(size_input);
    // The "+" button.
    new DOM.Element("button").add("+").listen("mousedown", (event) => {
        if (event.button === 0) {
            state.selected.set_width(state.selected.width + 1);
            smaller.element.disabled = state.selected.width === 0;
        }
    }).add_to(size_input);
    canvas.add(size_input);

    // The sidebar for the different tools that may be used (e.g. tiles, annotations, colours).
    const tools = new DOM.Div({
        id: "tools",
    });
    tools.listen("mousedown", (event) => {
        event.stopPropagation();
        state.focus_input(null);
    });

    // A helper function for adding a section to the tool sidebar.
    const add_section = (name) => {
        const section = new DOM.Div({ class: "section" }).add_to(tools);
        section.add(new DOM.Element("span", { class: "heading" }).add(name));
        return section;
    };

    // Add a section in the tool sidebar for tiles.
    const templates = add_section("Tiles");

    // A helper function for adding a tile template option to the tool sidebar.
    const add_tools_template = (template, parameters) => {
        const element = new DOM.Div({ class: "template" })
            .add(new template(state, parameters, true).svg);
        element.listen("mousedown", (event) => {
            if (event.button === 0) {
                // If the template is already selected, deselect it...
                if (element.class_list.contains("selected")) {
                    state.switch_mode(UIMode.default);
                } else {
                    // ...otherwise, activate the `UIMode.Tile`.
                    state.switch_mode(new UIMode.Tile(template, parameters));
                    element.class_list.add("selected");
                }
            }
        });
        // Add the template to the tool sidebar.
        return element.add_to(templates);
    };

    // We've hand-picked the layout of the templates rather than just enumerating them, so that they
    // look well-ordered. But that means there's some boilerplate here.
    for (const borders of [
        [0, 1, 1, 0], [0, 1, 1, 1], [0, 0, 1, 1], [0, 0, 1, 0],
        [1, 1, 1, 0], [1, 1, 1, 1], [1, 0, 1, 1], [1, 0, 1, 0],
        [1, 1, 0, 0], [1, 1, 0, 1], [1, 0, 0, 1], [1, 0, 0, 0],
        [0, 1, 0, 0], [0, 1, 0, 1], [0, 0, 0, 1]
    ]) {
        add_tools_template(Template.Border, borders);
    }
    add_tools_template(Template.Blank);
    // Curved borders.
    add_tools_template(Template.BorderCurve, [2]);
    add_tools_template(Template.BorderCurve, [3]);
    templates.add(new DOM.Element("br"));
    add_tools_template(Template.BorderCurve, [1]);
    add_tools_template(Template.BorderCurve, [0]);

    // Add a section in the tool sidebar for tiles.
    const annotations = add_section("Annotations");

    // A helper function for adding an annotation type to the tool sidebar.
    const add_tools_annotation = (type, name) => {
        const element = new DOM.Element("button", { class: "option" }).add(name);
        element.listen("mousedown", (event) => {
            if (event.button === 0) {
                // If the annotation is already selected, deselect it...
                if (element.class_list.contains("selected")) {
                    state.switch_mode(UIMode.default);
                } else {
                    // ...otherwise, activate the `UIMode.Annotation`.
                    state.switch_mode(new UIMode.Annotation(type));
                    element.class_list.add("selected");
                }
            }
        });
        return element.add_to(annotations);
    }

    add_tools_annotation(Annotation.Cell, "Cell");
    add_tools_annotation(Annotation.Arrow, "Arrow");

    // Add a section in the tool sidebar for colours. We don't populate it immediately, since we
    // determine the colour palette from the query string.
    const colours = add_section("Colours");

    // Add the command bar to the tools sidebar.
    const commands = new DOM.Div({ class: "commands" }).add_to(tools);

    // A helper function for adding a command button to the command bar.
    const add_command = (name, f) => {
        new DOM.Element("button").add(name).listen("mousedown", (event) => {
            if (event.button === 0) {
                f(event);
            }
        }).add_to(commands);
    };

    // Create a new diagram.
    add_command("New", () => {
        state.tangle = new Tangle();
        window.location = TangleImportExport.base64.export(state);
    });
    // Save the current diagram to the URL.
    add_command("Save", () => {
        history.pushState({}, "", TangleImportExport.base64.export(state));
    });
    // Export the current diagram as LaTeX.
    add_command("Export", () => {
        const export_pane = body.query_selector("#export");
        export_pane.query_selector(".code").clear().add(TangleExport.tikz.export(state));
        export_pane.class_list.remove("hidden");

        // Select the code for easy copying.
        const select_output = () => {
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(export_pane.query_selector(".code").element);
            selection.removeAllRanges();
            selection.addRange(range);
        };
        select_output();
        // Safari seems to occasionally fail to select the text immediately, so we
        // also select it after a delay to ensure the text is selected.
        delay(select_output);
    });
    // Centre the view on the diagram.
    add_command("Centre", () => {
        view.centre(state.tangle);
    });

    // Add the tool sidebar to the document.
    body.add(tools);

    // Create the `<input>` used for axis labels and cells.
    const input_area = new DOM.Div({ id: "input-area", class: "hidden" }).add_to(body);
    state.input = new DOM.Element("input", {
        id: "input", class: "hidden", type: "text", autocomplete: "off"
    }).listen("input", (_event, input) => {
        if (state.selected !== null) {
            state.selected.set_text(input.value);
        }
    }).add_to(input_area);

    // Handle tile and annotation placement.
    container.listen("mousedown", (event) => {
        if (event.button === 0) {
            const pointer_position = view.pointer_position(event);
            const [x, y] = [
                Math.round(pointer_position.x / CONSTANTS.TILE_WIDTH),
                Math.round(pointer_position.y / CONSTANTS.TILE_HEIGHT),
            ];
            // Clicking on any part of the diagram in default mode will simply unselect anything
            // that has been selected.
            if (state.in_mode(UIMode.Default)) {
                state.focus_input(null);
            }
            // Clicking in `UIMode.Tile` places a new tile (potentially replacing a tile that was
            // already at that position).
            if (state.in_mode(UIMode.Tile)) {
                state.replace_tile(new Point(x, y), state.mode.get_template(state));
            }
            // Clicking in `UIMode.Annotation` places a new annotation if there is none already in
            // that location (clicking on an existing annotation) focuses it.
            if (state.in_mode(UIMode.Annotation)) {
                let point;
                // Depending on the alignment of the annotation, the position of the annotation will
                // be calculated differently.
                switch (state.mode.type.alignment) {
                    case ALIGNMENT.CENTRE:
                        const [xh, yh] = [
                            Math.round(pointer_position.x / (CONSTANTS.TILE_WIDTH / 2)) / 2,
                            Math.round(pointer_position.y / (CONSTANTS.TILE_HEIGHT / 2)) / 2,
                        ];
                        point = new Point(xh + 0.5, yh + 0.5);
                        break;
                    case ALIGNMENT.EDGE:
                        // Work out the closest edge. This is a little subtle, because we
                        // essentially want to round to a rotated grid, which makes it a little
                        // harder to compute.
                        const [xs, ys] = [
                            pointer_position.x / CONSTANTS.TILE_WIDTH - 0.5,
                            pointer_position.y / CONSTANTS.TILE_HEIGHT - 0.5,
                        ];
                        const [xd, yd] = [
                            Math.abs(xs - Math.round(xs)),
                            Math.abs(ys - Math.round(ys)),
                        ];
                        if (xd <= yd) {
                            point = new Point(Math.round(xs) + 1, y + 0.5);
                        } else {
                            point = new Point(x + 0.5, Math.round(ys) + 1);
                        }
                        break;
                }
                // We only add a new annotation if there is not already one in that location.
                if (!state.tangle.annotations.has(`${point}`)) {
                    const annotation = state.tangle.add_annotation(state.mode.type, point);
                    annotation.element.add_to(canvas);
                    // Some annotations have special behaviour when placed.
                    switch (state.mode.type) {
                        // E.g. when we place a cell, we want to focus it immediately.
                        case Annotation.Cell:
                            delay(() => state.focus_input(annotation));
                            break;
                    }
                }
            }
        }
    });

    // We would rather disable context menus triggered by right-clicking, rather than necessariyl
    // all context menus, but it is more convenient to disable them all for now.
    container.listen("contextmenu", (event) => {
        cancel(event);
    });

    // The export pane that displays LaTeX output.
    const export_pane = new DOM.Div({ id: "export", class: "hidden" });
    // The tip reminding users they need to include `tangle.sty` in their LaTeX document.
    new DOM.Element("span", { class: "tip" })
        .add("Remember to include ")
        .add(new DOM.Element("code").add("\\usepackage{tangle}"))
        .add(" in your LaTeX preamble. You can ")
        .add(
            new DOM.Element("a", { href: "tangle.sty", download: "tangle.sty" })
                .add("download ")
                .add(new DOM.Element("code").add("tangle.sty"))
        )
        .add(", or ")
        .add(new DOM.Link(
            // We would like to simply use `tangle.sty` here, but, unfortunately, GitHub pages
            // does not permit overriding the `content-type` of a resource, and by default
            // `.sty` files are treated as `application/octet-stream`.
            "https://raw.githubusercontent.com/varkor/tangle/master/src/tangle.sty",
            "open it in a new tab",
            true,
        ))
        .add(" to copy-and-paste.")
        .add_to(export_pane);
    // The element that will actually contain the LaTeX output.
    export_pane.add(new DOM.Div({ class: "code" }))
        .add_to(body);

    // Some basic keyboard shortcuts, in lieu of a proper keyboard shortcut system for now.
    body.listen("keydown", (event) => {
        // Pressing escape hides the export pane.
        if (event.key === "Escape") {
            event.preventDefault();
            // Hide the export pane if it is visible.
            if (!export_pane.class_list.contains("hidden")) {
                export_pane.class_list.add("hidden");
                return;
            }
            // Hide the `<input>` and size input if they are visible.
            if (state.selected !== null) {
                state.focus_input(null);
            }
        }
        // Saving with ⌘S or Control + S.
        if (event.key === "s" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            history.pushState({}, "", TangleImportExport.base64.export(state));
        }
        // Zooming in/out with -/+.
        if (event.key === "=" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            view.pan_by(Point.zero(), 0.25);
        }
        if (event.key === "-" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            view.pan_by(Point.zero(), -0.25);
        }
    });

    // Now that the UI is set up, we load the tangle from the URL.
    const query_data = query_parameters();

    // Load the colour palette from the query string. This must be a comma-separated list of hex
    // colours (without the leading "#").
    if (query_data.has("c")) {
        state.colours = query_data.get("c").split(",").map((code) => {
            if (/^[a-f0-9]{6}$/i.test(code)) {
                return `#${code.toUpperCase()}`;
            } else {
                // If we can't parse the passed coour, default to white.
                return "white";
            }
        });
        // We record which colours in the colour palette were actually provided in the query string.
        // We may add more later if we need more colours to render the diagram, but we don't want to
        // save these additional colours later.
        state.saved_colours = state.colours.length;
    }

    // Load a diagram encoded in the query string, and instantiate the colour palette (which has
    // been loaded from the query string above, but may be modified by the diagram if we needed to
    // add some default colours).
    const load_diagram_from_query_string = () => {
        // If there is `t` parameter ("t" for "tangle") in the query string, try to decode it as a
        // diagram.
        if (query_data.has("t")) {
            try {
                // Decode the diagram.
                TangleImportExport.base64.import(query_data.get("t"), state);
                // Add the tiles to the body.
                for (const tile of state.tangle.tiles.values()) {
                    tile.element.add_to(canvas);
                }
                // Add the annotations (cells and arrows) to the body.
                for (const annotation of state.tangle.annotations.values()) {
                    annotation.element.add_to(canvas);
                }
                // Centre the view on the diagram.
                view.centre(state.tangle);
            } catch (error) {
                state.display_error(
                    "The saved diagram was malformed and could not be loaded."
                );
                // Rethrow the error so that it can be reported in the console.
                throw error;
            }
        }

        for (let i = 0; i < state.colours.length; ++i) {
            const element = new DOM.Div({ class: "colour" }, { background: state.colours[i] });
            element.listen("mousedown", () => {
                if (element.class_list.contains("selected")) {
                    state.switch_mode(UIMode.default);
                } else {
                    state.switch_mode(new UIMode.Colour(i));
                    element.class_list.add("selected");
                }
            });
            element.add_to(colours);
        }
    };

     // Immediately load the KaTeX library.
    const rendering_library = new DOM.Element("script", {
        type: "text/javascript",
        src: "KaTeX/katex.min.js",
    }).listen("error", () => {
        // Handle KaTeX not loading (somewhat) gracefully.
        state.display_error("KaTeX failed to load.");
    });

    state.KaTeX = new Promise((accept) => {
        rendering_library.listen("load", () => {
            accept(katex);
            // KaTeX is fast enough to be worth waiting for, but not immediately available. We
            // therefore delay loading the diagram until the library has loaded.
            load_diagram_from_query_string();
        });
    });

    // Load the style sheet needed for KaTeX.
    document.head.appendChild(new DOM.Element("link", {
        rel: "stylesheet",
        href: "KaTeX/katex.css",
    }).element);

    // Trigger the script load.
    document.head.appendChild(rendering_library.element);
});
