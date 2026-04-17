from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from django import template
from django.contrib.staticfiles import finders
from django.contrib.staticfiles.storage import staticfiles_storage
from django.templatetags.static import static

register = template.Library()


def _resolve_static_path(asset_path: str) -> Path | None:
    try:
        resolved = staticfiles_storage.path(asset_path)
        file_path = Path(resolved)
        if file_path.exists():
            return file_path
    except Exception:
        pass

    resolved = finders.find(asset_path)
    if isinstance(resolved, (list, tuple)):
        resolved = resolved[0] if resolved else None
    if not resolved:
        return None
    return Path(resolved)


@register.simple_tag
def versioned_static(asset_path: str) -> str:
    url = static(asset_path)
    file_path = _resolve_static_path(asset_path)
    if not file_path:
        return url

    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query["v"] = str(file_path.stat().st_mtime_ns)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))
