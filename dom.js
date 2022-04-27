"use strict";

/// A helper method to trigger later in the event queue.
function delay(f, duration = 0) {
    setTimeout(f, duration);
}

/// A helper method to cancel the default behaviour of an event.
function cancel(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
}

// Older versions of Safari are problematic because they're essentially tied to the macOS version,
// and may not have support for pointer events. In this case, we simply replace them with mouse
// events instead.
// This should behave acceptably, because we don't access many pointer-specific properties in the
// pointer events, and for those that we do, `undefined` will behave as expected.
function pointer_event(name) {
    if (`onpointer${name}` in document.documentElement) {
        return `pointer${name}`;
    } else {
        return `mouse${name}`;
    }
}

/// A helper object for dealing with the DOM.
const DOM = {};

/// A class for conveniently dealing with elements. It's primarily useful in giving us a way to
/// create an element and immediately set properties and styles, in a single statement.
DOM.Element = class {
    /// `from` has two forms: a plain string, in which case it is used as a `tagName` for a new
    /// element, or an existing element, in which case it is wrapped in a `DOM.Element`.
    constructor(from, attributes = {}, style = {}, namespace = null) {
        if (from instanceof DOM.Element) {
            // Used when we want to convert between different subclasses of `DOM.Element`.
            this.element = from.element;
        } else if (typeof from !== "string") {
            this.element = from;
        } else if (namespace !== null) {
            this.element = document.createElementNS(namespace, from);
        } else {
            this.element = document.createElement(from);
        }
        this.set_attributes(attributes);
        this.set_style(style);
    }

    get id() {
        return this.element.id;
    }

    get class_list() {
        return this.element.classList;
    }

    get parent() {
        return new DOM.Element(this.element.parentElement);
    }

    /// Appends an element.
    /// `value` has three forms: a plain string, in which case it is added as a text node; a
    /// `DOM.Element`, in which case the corresponding element is appended; or a plain element.
    add(value) {
        if (value instanceof DOM.Element) {
            this.element.appendChild(value.element);
        } else if (typeof value !== "string") {
            this.element.appendChild(value);
        } else {
            this.element.appendChild(document.createTextNode(value));
        }
        return this;
    }

    /// Appends this element to the given one.
    add_to(value) {
        if (value instanceof DOM.Element) {
            value.element.appendChild(this.element);
        } else {
            value.appendChild(this.element);
        }
        return this;
    }

    /// Removes the element from the DOM.
    remove() {
        this.element.remove();
    }

    /// Adds an event listener.
    listen(type, f) {
        this.element.addEventListener(type, event => f(event, this.element));
        return this;
    }

    /// Removes all children from the element.
    clear() {
        while (this.element.firstChild !== null) {
            this.element.firstChild.remove();
        }
        return this;
    }

    /// Shorthand for `clear().add(...)`.
    replace(value) {
        return this.clear().add(value);
    }

    query_selector(selector) {
        const element = this.element.querySelector(selector);
        if (element !== null) {
            return new DOM.Element(element);
        } else {
            return null;
        }
    }

    query_selector_all(selector) {
        const elements = Array.from(this.element.querySelectorAll(selector));
        return elements.map((element) => new DOM.Element(element));
    }

    get_attribute(attribute) {
        return this.element.getAttribute(attribute);
    }

    set_attributes(attributes = {}) {
        for (const [attribute, value] of Object.entries(attributes)) {
            if (value !== null) {
                this.element.setAttribute(attribute, value);
            } else {
                this.element.removeAttribute(attribute);
            }
        }
        return this;
    }

    remove_attributes(...attributes) {
        for (const attribute of attributes) {
            this.element.removeAttribute(attribute);
        }
        return this;
    }

    set_style(style = {}) {
        Object.assign(this.element.style, style);
    }

    clone() {
        return new DOM.Element(this.element.cloneNode());
    }

    bounding_rect() {
        return this.element.getBoundingClientRect();
    }

    dispatch(event) {
        this.element.dispatchEvent(event);
        return this;
    }

    contains(other) {
        return this.element.contains(other.element);
    }
};

DOM.Div = class extends DOM.Element {
    constructor(attributes = {}, style = {}) {
        super("div", attributes, style);
    }
};

/// A class for conveniently dealing with SVGs.
DOM.SVGElement = class extends DOM.Element {
    constructor(tag_name, attributes = {}, style = {}) {
        super(tag_name, attributes, style, DOM.SVGElement.NAMESPACE);
    }
};
DOM.SVGElement.NAMESPACE = "http://www.w3.org/2000/svg";

// A class for conveniently dealing with hyperlinks.
DOM.Link = class extends DOM.Element {
    constructor(url, content, new_tab = false, attributes = {}, style = {}) {
        super("a", Object.assign({ href: url }, attributes), style);
        if (new_tab) {
            this.set_attributes({ target: "_blank" });
        }
        this.add(content);
    }
};
