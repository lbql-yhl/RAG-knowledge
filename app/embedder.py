from fastembed import TextEmbedding

from . import config

_model = None


def get_model():
    global _model
    if _model is None:
        _model = TextEmbedding(model_name=config.EMBED_MODEL)
    return _model


def embed_documents(texts):
    model = get_model()
    return [list(v) for v in model.embed(texts)]


def embed_query(text):
    model = get_model()
    return list(model.query_embed(text))[0]
