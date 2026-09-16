import re
import unicodedata

import markdown


def slugify(value, separator="-"):
    value = unicodedata.normalize("NFKC", value)
    value = re.sub(r"[^\w\s-]", "", value)
    value = value.strip().lower()
    return re.sub(r"[-\s]+", separator, value)


EXTENSIONS = [
    "tables",
    "sane_lists",
    "attr_list",
    "def_list",
    "footnotes",
    "abbr",
    "admonition",
    "md_in_html",
    "toc",
    "pymdownx.tasklist",
    "pymdownx.superfences",
    "pymdownx.tilde",
    "pymdownx.mark",
    "pymdownx.caret",
    "pymdownx.details",
    "pymdownx.magiclink",
    "pymdownx.smartsymbols",
    "pymdownx.highlight",
    "pymdownx.inlinehilite",
]

EXTENSION_CONFIGS = {
    "toc": {"slugify": slugify},
    "pymdownx.tasklist": {"custom_checkbox": True},
    "pymdownx.highlight": {
        "noclasses": True,
        "pygments_style": "monokai",
        "guess_lang": False,
    },
}


def render(text):
    return markdown.markdown(
        text,
        extensions=EXTENSIONS,
        extension_configs=EXTENSION_CONFIGS,
        output_format="html5",
    )
