# **tangle**

**tangle** is a work-in-progress graphical editor for [string diagrams](https://en.wikipedia.org/wiki/String_diagram), along with an accompanying TikZ library for exporting to LaTeX.

**tangle** is a companion project to the commutative and pasting diagram editor [**quiver**](https://github.com/varkor/quiver). However, it is still in the early stages of development and is not yet as fully featured and polished.

At present, **tangle** is designed primarily for editing [string diagrams for double categories](https://arxiv.org/abs/1612.02762) and [virtual equipments](https://arxiv.org/abs/2003.02124). However, since these settings subsume those of [monoidal categories](https://en.wikipedia.org/wiki/Monoidal_category), [multicategories](https://en.wikipedia.org/wiki/Multicategory), and [bicategories](https://en.wikipedia.org/wiki/Bicategory), it is also possible to use **tangle** to design string diagrams for these structures. Note that there is not yet any support for [symmetry](https://en.wikipedia.org/wiki/Symmetric_monoidal_category).

## Using **tangle**

1. Import the **tangle** package in your LaTeX document:
    ```latex
    \usepackage{tangle}
    ```
    **tangle** is not yet available on [CTAN](https://ctan.org/), so you will need to include `tangle.sty` in your files.
1. Declare your colour scheme at the start of your document. This is a list of HTML colour codes.
    ```latex
    % https://varkor.github.io/tangle/?c=F5A3A3,F5CCA3,F5F5A3,CCF5A3,A3F5A3,A3F5CC,A3F5F5,A3CCF5,A3A3F5,CCA3F5,F5A3F5,F5A3CC
    \tgColours{F5A3A3,F5CCA3,F5F5A3,CCF5A3,A3F5A3,A3F5CC,A3F5F5,A3CCF5,A3A3F5,CCA3F5,F5A3F5,F5A3CC}
    ```
1. Open the [**tangle** string diagram editor](https://varkor.github.io/tangle). Make sure to include the colour scheme in the URL query string, for instance:
    ```
    https://varkor.github.io/tangle/?c=F5A3A3,F5CCA3,F5F5A3,CCF5A3,A3F5A3,A3F5CC,A3F5F5,A3CCF5,A3A3F5,CCA3F5,F5A3F5,F5A3CC
    ```
1. Draw your string diagram in the editor, by placing tiles, cells, and arrows, and colouring regions. Labels on the axes of the diagram can be added by clicking on the squares surround the diagram. Right-click to delete elements of the diagram.
1. Export the diagram to LaTeX and paste the generated diagram into your document. The exported diagram includes a URL that can be used to modify the diagram in the future.

## The **tangle** library

It should not be necessary to manually design diagrams using the `tangle.sty` package, so we do not include detailed documentation for now.

The philosophy of **tangle** is that string diagrams can be designed according to a grid. This leads to a uniform aesthetic. Although this conformity to a grid is not always the most convenient choice, it facilitates the design of a graphical editor.

## Building

See [the instructions](https://github.com/varkor/quiver#building) for **quiver**, which also apply to **tangle**.
