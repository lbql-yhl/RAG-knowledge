from qdrant_client import QdrantClient
from qdrant_client.models import Distance, FieldCondition, Filter, FilterSelector, MatchAny, MatchValue, VectorParams

from . import config

_client = None


def get_client():
    global _client
    if _client is None:
        _client = QdrantClient(path=config.QDRANT_PATH)
    return _client


def ensure_collection():
    client = get_client()
    if not client.collection_exists(config.COLLECTION_NAME):
        client.create_collection(
            collection_name=config.COLLECTION_NAME,
            vectors_config=VectorParams(size=config.EMBED_DIM, distance=Distance.COSINE),
        )


def upsert(points):
    client = get_client()
    ensure_collection()
    client.upsert(collection_name=config.COLLECTION_NAME, points=points)


def search(query_vector, top_k, libraries=None):
    client = get_client()
    ensure_collection()
    query_filter = None
    if libraries:
        query_filter = Filter(must=[FieldCondition(key="library", match=MatchAny(any=list(libraries)))])
    res = client.query_points(
        collection_name=config.COLLECTION_NAME,
        query=query_vector,
        limit=top_k,
        query_filter=query_filter,
        with_payload=True,
    )
    return res.points


def delete_source(source):
    client = get_client()
    ensure_collection()
    client.delete(
        collection_name=config.COLLECTION_NAME,
        points_selector=FilterSelector(
            filter=Filter(must=[FieldCondition(key="source", match=MatchValue(value=source))])
        ),
    )


def replace_source(source, points):
    delete_source(source)
    if points:
        upsert(points)
