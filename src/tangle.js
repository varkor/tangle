"use strict";

/// Global options for the editor.
const OPTIONS = {
    /// Whether to log debug messages.
    DEBUG_MODE: true,
    /// Whether to include the colour definitions when exporting to TikZ. Typically we expect
    /// colours to have been defined by users beforehand.
    INCLUDE_COLOUR_DEFINITIONS: false,
};

/// A region represents a contiguous space containing vertices. These are the areas that may be
/// flood-filled in the diagram.
class Region {
    constructor() {
        this.vertices = new Set();
        this.colour = null;
    }

    // Combines `this` region with the `other` region. In practice, this means all the vertices from
    // `other` are moved to `this` region. The colour of `this` is usually preserved, though if
    // `this` is uncoloured and the `other` is coloured, we also inherit the colour.
    combine(other) {
        this.vertices = new Set([...this.vertices, ...other.vertices]);
        for (const vertex of other.vertices) {
            vertex.region = this;
        }
        this.colour = this.colour !== null ? this.colour : other.colour;
    }

    add_vertex(element) {
        const vertex = new Vertex(this, element);
        this.vertices.add(vertex);
        return vertex;
    }
}

/// A vertex is a subregion of a tile. Vertices of different tiles may be connected to form regions.
class Vertex {
    constructor(region, element) {
        this.region = region;
        this.connections = new Set();
        this.element = element;
    }
}

/// The region graph records the contiguous regions of a diagram and the vertices that form them.
/// This is used to perform flood-filling. A region graph is essentially a graph that specifically
/// tracks connected components (which is important for determining tile colours). Each `Region`
/// is a connected component, and these are updated as vertices are connected or disconnected.
class RegionGraph {
    constructor() {
        this.regions = new Set();
    }

    /// Add a new disconnected vertex (and associated region) to the graph.
    add_vertex(element) {
        const region = new Region();
        this.regions.add(region);
        return region.add_vertex(element);
    }

    /// Connect two vertices, and merge their regions if their regions are distinct.
    connect(v1, v2) {
        v1.connections.add(v2);
        v2.connections.add(v1);
        if (v1.region === v2.region) {
            return;
        }
        this.regions.delete(v2.region);
        v1.region.combine(v2.region);
    }

    /// Disconnect two vertices. If they are now no longer connected by a path, we create a new
    /// region so that the two connected components are recorded.
    disconnect(v1, v2) {
        if (!v1.connections.has(v2) || !v2.connections.has(v1)) {
            console.error(`Vertices ${v1} and ${v2} are not connected.`);
        }
        v1.connections.delete(v2);
        v2.connections.delete(v1);
        const v1_vertices = new Set([v1]);
        const v2_vertices = new Set([v2]);
        // Work out whether the two vertices are connected by a path.
        // First, we explore from `v1`.
        let explore = [v1];
        while (explore.length > 0) {
            for (const vertex of explore.shift().connections) {
                if (vertex === v2) {
                    // The regions are still connected.
                    return;
                }
                if (!v1_vertices.has(vertex)) {
                    v1_vertices.add(vertex);
                    explore.push(vertex);
                }
            }
        }
        // Next, we explore from `v2`.
        explore = [v2];
        while (explore.length > 0) {
            for (const vertex of explore.shift().connections) {
                if (v1_vertices.has(vertex)) {
                    // This branch should not occur, but is included as a fail-safe.
                    console.error("Regions should be disconnected.");
                    return;
                }
                if (!v2_vertices.has(vertex)) {
                    v2_vertices.add(vertex);
                    explore.push(vertex);
                }
            }
        }
        // In this case, there are now two disconnected regions.
        const region = new Region();
        this.regions.add(region);
        v1.region.vertices = v1_vertices;
        region.vertices = v2_vertices;
        region.colour = v1.region.colour;
        for (const vertex of v2_vertices) {
            vertex.region = region;
        }
    }

    /// Remove a vertex from the graph.
    remove_vertex(v1) {
        for (const v2 of v1.connections) {
            this.disconnect(v1, v2);
        }
        // `v1` is now entirely disconnected, hence its region contains only `v1` and may be
        // deleted.
        this.regions.delete(v1.region);
    }
}

/// The data structure that records the structure of the diagram, i.e. the tiles and annotations
/// that have been placed, and the labels surrounding the diagram.
class Tangle {
    constructor() {
        this.tiles = new Map();
        this.annotations = new Map();
        this.labels = new Map();
    }

    /// Return the origin (i.e. top-left) of the diagram, the co-origin (i.e. the bottom-right) of
    /// the diagram, and the size (i.e. width and height) of the diagram.
    dimensions() {
        // Account for an empty grid.
        if (this.tiles.size === 0) {
            return { origin: Point.zero(), coorigin: Point.zero(), size: Point.zero() };
        }
        let origin = Point.diag(Infinity);
        let coorigin = Point.diag(-Infinity);
        for (const tile of this.tiles.values()) {
            origin = origin.min(tile.position);
            coorigin = coorigin.max(tile.position);
        }
        const size = coorigin.sub(origin).add(Point.diag(1));
        return { origin, coorigin, size };
    }

    /// Iterates through each tile of the diagram and applies `tile_map(tile, position)` to each
    /// square. Returns the size and origin of the diagram (see `dimensions`), and an array of
    /// arrays containing the results of `tile_map`. `empty` is the value that should be used for
    /// those grid positions that contain no tile.
    grid(tile_map, empty = null) {
        const rows = [];
        let { size, origin } = this.dimensions();
        for (let y = 0; y < size.y; ++y) {
            const row = [];
            rows.push(row);
            for (let x = 0; x < size.x; ++x) {
                const xy = new Point(x, y);
                const position = `${origin.add(xy)}`;
                if (this.tiles.has(position)) {
                    row.push(tile_map(this.tiles.get(position), xy));
                } else {
                    row.push(empty);
                }
            }
        }
        return { size, origin, rows };
    }

    /// Returns the nonempty labels in a sorted order so that labels can be exported in a consistent
    /// order.
    nonempty_labels() {
        const labels = Array.from(this.labels.values()).flat()
            // Filter out the nonempty labels.
            .filter((label) => label !== null && label.text.trim() !== "")
            // Calculate the position of the label (relative to its tile and its direction).
            .map((label) => {
                const position = label.position.add(
                    // We offset the position (which is the position of the tile to which the label
                    // is attached) by the direction of the label. This way if we have a tile at
                    // y = 0 with a label B at the bottom, and a tile at y = 1 with a label A at the
                    // top, A will be sorted before B.
                    Tangle.adjacent_offset(label.direction).mul(0.75)
                );
                return [position, label];
            });
        labels.sort(([a,], [b,]) => {
            if (a.y < b.y) return -1;
            if (b.y < a.y) return 1;
            return a.x - b.x;
        });
        return labels.map(([, label]) => label);
    }

    static adjacent_offset(direction) {
        return new Point(...[[1, 0], [0, 1], [-1, 0], [0, -1]][direction]);
    }

    /// Clears the diagram.
    clear() {
        for (const tile of Array.from(this.tiles.values())) {
            this.remove_tile(tile);
        }
        for (const annotation of Array.from(this.annotations.values())) {
            this.remove_annotation(annotation);
        }
    }

    /// Add a new tile to the diagram, and return the new tile.
    add_tile(state, template, position) {
        const tile = new Tile(state, template, position);
        this.tiles.set(`${position}`, tile);
        // Anchors
        for (let i = 0; i < 4; ++i) {
            const adjacent_position = position.add(Tangle.adjacent_offset(i));
            const adjacent = this.tiles.get(`${adjacent_position}`);
            // Check whether there are adjacent tiles.
            if (adjacent) {
                // Connect vertices in adjacent tiles in the region graph.
                state.region_graph.connect(
                    adjacent.template.vertex_at((i + 0) % 4), template.vertex_at((i + 1) % 4));
                state.region_graph.connect(
                    adjacent.template.vertex_at((i + 3) % 4), template.vertex_at((i + 2) % 4));

                // If there is an adjacent tile, we must hide the anchors for the current and
                // adjacent tile, and also remove any present labels that would overlap the current
                // tile.
                const i_op = (i + 2) % 4;
                tile.anchors[i].class_list.add("hidden");
                adjacent.anchors[i_op].class_list.add("hidden");
                if (this.labels.has(`${adjacent_position}`)) {
                    const label = this.labels.get(`${adjacent_position}`)[i_op];
                    if (label !== null) {
                        const text = label.text;
                        this.remove_label(adjacent_position, i_op);
                        // We try to add the label back, on the new tile.
                        // Check whether there's space for the label.
                        if (!this.tiles.has(`${position.add(Tangle.adjacent_offset(i_op))}`)) {
                            tile.set_label(i_op, text);
                        }
                    }
                }
            }
        }
        return tile;
    }

    /// Remove a tile from the diagram. If `remove_dependents`, then any annotations on top of the
    /// tile will also be removed.
    remove_tile(tile, remove_dependents = true) {
        tile.element.remove();
        this.tiles.delete(`${tile.position}`);
        // Remove the vertices corresponding to the tile from the region graph.
        for (const vertex of tile.template.all_vertices()) {
            state.region_graph.remove_vertex(vertex);
        }
        if (remove_dependents) {
        // If there is an annotation centred on the tile, remove it.
            const annotation = this.annotations.get(`${tile.position.add(new Point(0.5, 0.5))}`);
            if (annotation) {
                this.remove_annotation(annotation);
            }
        }
        // Remove labels attached to the tile.
        if (this.labels.has(`${tile.position}`)) {
            for (const label of this.labels.get(`${tile.position}`).values()) {
                // Hide the `<input>` if the label was focused.
                if (state.selected === label) {
                    state.focus_input(null);
                }
            }
        }
        this.labels.delete(`${tile.position}`);
        // Update anchors for tiles adjacent to the current one.
        for (let i = 0; i < 4; ++i) {
            const adjacent = this.tiles.get(`${tile.position.add(Tangle.adjacent_offset(i))}`);
            if (adjacent) {
                adjacent.anchors[(i + 2) % 4].class_list.remove("hidden");
            }
        }
    }

    /// Add an annotation to the diagram, and return the annotation.
    add_annotation(type, position, properties = {}) {
        const annotation = new type(this, position, properties);
        this.annotations.set(`${position}`, annotation);
        return annotation;
    }

    /// Remove an annotation from the diagram.
    remove_annotation(annotation) {
        annotation.element.remove();
        this.annotations.delete(`${annotation.position}`);
    }

    /// Overwrites the specified label. 
    set_label(position, direction, label) {
        if (!this.labels.has(`${position}`)) {
            this.labels.set(`${position}`, [null, null, null, null]);
        }
        this.labels.get(`${position}`)[direction] = label;
    }

    /// Removes a label from the diagram.
    remove_label(position, direction) {
        const labels = this.labels.get(`${position}`);
        labels[direction].element.remove();
        labels[direction] = null;
        if (labels.every((label) => label === null)) {
            this.labels.delete(`${position}`);
        }
    }
}

/// Various methods of exporting a tangle.
class TangleExport {
    /// A method to export a tangle as a string.
    export() {}
}

/// Various methods of exporting and importing a tangle.
class TangleImportExport extends TangleExport {
    /// A method to import a tangle as a string. `import(export(tangle))` should be the
    /// identity function.
    import() {}
}

TangleImportExport.base64 = new class extends TangleImportExport {
    /// [ [colours], rows, annotations, labels ]
    /// - A colour is an index, or -1 if no colour is set for that region.
    /// - Each row contains an array of tiles.
    ///     - A tile is [id, parameters].
    /// - An annotation is [id, x, y, parameters].
    /// - A label is [x, y, direction, text].
    /// Empty arrays are trimmed where possible to reduce encoding size.
    export(state) {
        // Remove the query string from the current URL and use that as a base.
        const URL_prefix = window.location.href.replace(/\?.*$/, "");
        // Store the colours in the URL, so that 
        const colour_data = state.saved_colours > 0 ? `c=${
            state.colours.slice(0, state.saved_colours).map((colour) => colour.replace("#", ""))
        }` : "";

        // If the diagram is empty, we can export it straight away.
        if (state.tangle.tiles.size === 0 && state.tangle.annotations.size === 0) {
            // There is no need to encode an empty diagram.
            return `${URL_prefix}?${colour_data}`;
        }

        // We keep track of the order in which regions will be visited so that we can store region
        // colour information in the right order for decoding later.
        const region_order = new Set();

        const pop_while = (array, condition) => {
            while (array.length > 0 && condition(array[array.length - 1])) {
                array.pop();
            }
        };

        // Encode the tile data.
        const { origin, rows } = state.tangle.grid((tile) => {
            const template = tile.template;
            let id = null, parameters = [];
            switch (template.constructor) {
                case Template.Blank:
                    id = 0;
                    break;
                case Template.Border:
                    id = 1;
                    // The parameters are a list of 0 or 1 entries.
                    parameters = template.borders.map((border) => +border);
                    break;
                case Template.BorderCurve:
                    // Direction is 0 through to 3.
                    parameters = [template.direction];
                    id = 2;
                    break;
            }
            for (const vertex of template.all_vertices()) {
                region_order.add(vertex.region);
            }
            return [id, parameters];
        }, []);
        // We don't record empty cells at the end of a row.
        rows.forEach((cells) => pop_while(cells, (cell) => cell.length === 0));

        const output = [];
        const colours = Array.from(region_order).map((region) => region.colour);
        // We don't record the colour of regions if they have the default colour, except as a spacer
        // where necessary.
        pop_while(colours, (colour) => colour === null);

        // Push the global options to the output.
        output.push([
            // The region colours.
            colours.map((colour) => (colour !== null ? colour + 1 : 0))
        ]);
        // Push the rows to the output.
        output.push(rows);
        // Push the annotations to the output.
        output.push(Array.from(state.tangle.annotations.values()).map((annotation) => {
            let id = null, parameters = [];
            switch (annotation.constructor) {
                case Annotation.Cell:
                    id = 0;
                    parameters = [annotation.text];
                    // If `height` is nonzero, we must always push the `width` so that the `height`
                    // is stored at the correct index, but if the `height` is zero, there is no need
                    // to store it.
                    if (annotation.width > 0 || annotation.height > 0) {
                        parameters.push(annotation.width);
                        if (annotation.height > 0) {
                            parameters.push(annotation.height);
                        }
                    }
                    break;
                case Annotation.Arrow:
                    id = 1;
                    parameters = [+annotation.flip];
                    break;
            }
            const position = annotation.position.sub(origin);
            return [id, position.x, position.y, parameters];
        }));
        // Push the labels to the output.
        output.push(Array.from(state.tangle.nonempty_labels().map((label) => {
            const position = label.position.sub(origin);
            return [position.x, position.y, label.direction, label.text];
        })));

        // Don't record empty arrays at the end of the output.
        pop_while(output, (data) => data.length === 0);

        if (OPTIONS.DEBUG_MODE) {
            // Log the output for debugging purposes.
            console.log(output);
        }
        
        // We use this `unescape`-`encodeURIComponent` trick to encode non-ASCII characters.
        return `${URL_prefix}?t=${
            btoa(unescape(encodeURIComponent(JSON.stringify(output))))
        }${colour_data.length > 0 ? `&${colour_data}` : ""}`;
    }

    import(string, state, origin = Point.zero()) {
        let input;
        try {
            // We use this `decodeURIComponent`-`escape` trick to encode non-ASCII characters.
            const decoded = decodeURIComponent(escape(atob(string)));
            input = JSON.parse(decoded);
        } catch (_) {
            throw new Error("invalid base64 or JSON");
        }
        if (OPTIONS.DEBUG_MODE) {
            // Log the input for debugging purposes.
            console.log(input);
        }

        let region_colours, rows, annotations, labels;
        [[region_colours = []], rows = [], annotations = [], labels = []] = input;

        // Add the tiles to the diagram.
        let [x, y] = [0, 0];
        for (let row of rows) {
            for (let tile of row) {
                // If the tile is `[]`, then this represents an empty space.
                if (tile.length === 0) {
                    ++x;
                    continue;
                }
                const [id, parameters] = tile;
                let template = null;
                let i = 0;
                switch (id) {
                    case i++:
                        template = new Template.Blank(state);
                        break;
                    case i++:
                        const [north, east, south, west] = parameters;
                        template = new Template.Border(state, [!!north, !!east, !!south, !!west]);
                        break;
                    case i++:
                        template = new Template.BorderCurve(state, parameters);
                        break;
                    default:
                        console.error("unknown tile template:", id);
                        ++x;
                        continue;
                }
                state.tangle.add_tile(state, template, new Point(x, y).add(origin));
                
                ++x;
            }
            x = 0;
            ++y;
        }

        // Deduce the visit order of regions, so that we can assign colours to regions according to
        // the order that they were saved.
        const region_order = new Set();
        for (const [,tile] of state.tangle.tiles) {
            for (const vertex of tile.template.all_vertices()) {
                region_order.add(vertex.region);
            }
        }

        // It could be that a diagram is loaded that uses more colours than the user has provided.
        // In this case, we have a set of default colours for convenience, so that the distinction
        // between regions can at least be seen. (If the diagram has more than 12 regions without
        // colour, we will default to white thereafter.)
        const default_colours = [];
        for (let i = 0; i < 12; ++i) {
            default_colours.push(`hsl(${i * 360 / 12}, 80%, 80%)`);
        }

        // Colour the regions.
        let i = 0;
        for (const region of region_order) {
            const colour = i < region_colours.length ? region_colours[i] - 1 : -1;
            while (colour >= state.colours.length) {
                state.colours.push(
                    default_colours.length > 0 ? default_colours.shift() : "#FFFFFF"
                );
            }
            if (colour !== -1) {
                region.colour = colour;
                for (const vertex of region.vertices) {
                    vertex.element.set_style({ fill: state.colours[colour] });
                }
            }
            ++i;
        }

        // Add the annotations.
        for (let [id, x, y, linear_parameters] of annotations) {
            let i = 0;
            let type, parameters;
            switch (id) {
                case i++:
                    type = Annotation.Cell;
                    const [text, width = 0, height = 0] = linear_parameters;
                    parameters = { text, width, height };
                    break;
                case i++:
                    type = Annotation.Arrow;
                    const [flip] = linear_parameters;
                    parameters = { flip: !!flip };
                    break;
                default:
                    console.error("unknown annotation type:", id);
                    continue;
            }
            state.tangle.add_annotation(type, new Point(x, y).add(origin), parameters);
        }

        // Add the labels.
        for (let [x, y, direction, label] of labels) {
            const position = new Point(x, y).add(origin);
            state.tangle.set_label(position, direction, label);
            const tile = state.tangle.tiles.get(`${position}`);
            tile.set_label(direction, label);
        }
    }
};

TangleExport.tikz = new class extends TangleExport {
    export(state) {
        // Encode the tiles as TikZ.
        const { size, origin, rows } = state.tangle.grid((tile, xy) => {
            return tile.template.export_tikz(xy);
        });
        
        const output = [];

        if (OPTIONS.INCLUDE_COLOUR_DEFINITIONS) {
            // Append the TikZ for the colour definitions.
            const colours = state.colours.slice(0, state.saved_colours);
            output.push(
                `\\tgColours{${colours.map((colour) => colour.replace("#", "")).join(",")}}`);
        }
        // Append the TikZ for the tiles.
        output.push(...rows.flat().filter((line) => line !== null));
        // Append the TikZ for the annotations.
        output.push(...Array.from(state.tangle.annotations.values()).map((annotation) => {
            return annotation.export_tikz(origin);
        }));
        // Append the TikZ for the labels.
        for (const label of state.tangle.nonempty_labels()) {
            const anchor = ["west", "north", "east", "south"][label.direction];
            let position = label.position.add(new Point(0.5, 0.5))
                .sub(origin)
                .add(Tangle.adjacent_offset(label.direction).mul(0.5));
            // If we are trimming the diagram, the outer labels need to be adjusted accordingly.
            if (state.settings.get("export.trim_diagram")) {
                if (label.direction === 0 && position.x >= size.x - 0.75) {
                    position = position.sub(new Point(0.75, 0));
                }
                if (label.direction === 1 && position.y >= size.y - 0.75) {
                    position = position.sub(new Point(0, 0.75));
                }
                if (label.direction === 2 && position.x <= 0.75) {
                    position = position.add(new Point(0.75, 0));
                }
                if (label.direction === 3 && position.y <= 0.75) {
                    position = position.add(new Point(0, 0.75));
                }
            }
            output.push(
                `\\tgAxisLabel{(${position})}{${anchor}}{${label.text}}`);
        }

        return `% ${
            TangleImportExport.base64.export(state)
        }\n\\begin{tangle}{(${size})}${
            state.settings.get("export.trim_diagram") ? "[trim x, trim y]" : ""
        }${output.length > 0 ? "\n\t" : ""}${   
            output.join("\n\t")
        }\n\\end{tangle}`;
    }
};
