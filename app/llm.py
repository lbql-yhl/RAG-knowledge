from langchain_core.prompts import ChatPromptTemplate
from openai import OpenAI

from . import config

_client = None
_PROMPT_TEMPLATE = ChatPromptTemplate.from_messages(
    [
        ("system", "{system_prompt}"),
        ("human", "{user_prompt}"),
    ]
)


def get_client():
    global _client
    if _client is None:
        _client = OpenAI(api_key=config.DEEPSEEK_API_KEY, base_url=config.DEEPSEEK_BASE_URL)
    return _client


def generate(system_prompt, user_prompt):
    client = get_client()
    prompt_messages = _PROMPT_TEMPLATE.format_messages(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
    )
    resp = client.chat.completions.create(
        model=config.DEEPSEEK_MODEL,
        messages=[
            {
                "role": "system" if message.type == "system" else "user",
                "content": message.content,
            }
            for message in prompt_messages
        ],
        temperature=0.3,
    )
    return resp.choices[0].message.content
