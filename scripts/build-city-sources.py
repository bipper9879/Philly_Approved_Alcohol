import argparse
import json
import re
from pathlib import Path


WORKBOOK_EXTENSIONS = {".xlsx", ".xlsm", ".xls"}


def normalize_text(value: str) -> str:
    return (value or "").strip()


def slugify(value: str) -> str:
    text = normalize_text(value).lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text or "city"


def load_city_registry(repo_root: Path):
    cities_path = repo_root / "data" / "cities.json"
    if not cities_path.exists():
        return []
    try:
        payload = json.loads(cities_path.read_text(encoding="utf-8"))
    except Exception:
        return []
    if not isinstance(payload, list):
        return []
    names = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        if item.get("active", True) is False:
            continue
        name = normalize_text(str(item.get("name", "")))
        if name:
            names.append(name)
    return names


def find_city_folder(root_path: Path, city_name: str):
    target = city_name.lower()
    for child in root_path.iterdir():
        if child.is_dir() and child.name.lower() == target:
            return child
    return None


def choose_workbook(city_folder: Path, city_name: str):
    files = [f for f in city_folder.iterdir() if f.is_file() and f.suffix.lower() in WORKBOOK_EXTENSIONS]
    if not files:
        return None

    city_token = re.sub(r"[^a-z0-9]", "", city_name.lower())

    def score(file_path: Path):
        base = file_path.stem.lower()
        base_token = re.sub(r"[^a-z0-9]", "", base)
        if city_token and city_token in base_token and "workbook" in base_token:
            return 0
        if "workbook" in base_token:
            return 1
        return 2

    files.sort(key=lambda f: (score(f), f.name.lower()))
    return files[0]


def load_existing_output(output_path: Path):
    if not output_path.exists():
        return []
    try:
        payload = json.loads(output_path.read_text(encoding="utf-8"))
    except Exception:
        return []
    return payload if isinstance(payload, list) else []


def main():
    parser = argparse.ArgumentParser(description="Build data/city-sources.json from a synced SharePoint root folder.")
    parser.add_argument("--root-path", required=True, help="Root folder containing city folders")
    parser.add_argument(
        "--repo-root",
        default=str(Path(__file__).resolve().parent.parent),
        help="Repository root path",
    )
    parser.add_argument(
        "--output",
        default="data/city-sources.json",
        help="Output path relative to repo root or absolute path",
    )
    parser.add_argument(
        "--cities",
        default="",
        help="Optional comma-separated city list override (default: active names from data/cities.json)",
    )
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    root_path = Path(args.root_path).resolve()
    output_path = Path(args.output)
    if not output_path.is_absolute():
        output_path = (repo_root / output_path).resolve()

    if not root_path.exists() or not root_path.is_dir():
        raise FileNotFoundError(f"Root folder not found: {root_path}")

    if normalize_text(args.cities):
        cities = [normalize_text(part) for part in args.cities.split(",") if normalize_text(part)]
    else:
        cities = load_city_registry(repo_root)
        if not cities:
            cities = sorted([child.name for child in root_path.iterdir() if child.is_dir()], key=lambda n: n.lower())

    existing = load_existing_output(output_path)
    existing_by_id = {}
    for item in existing:
        if isinstance(item, dict):
            item_id = normalize_text(str(item.get("id", "")))
            if item_id:
                existing_by_id[item_id] = item

    result = []
    missing = []
    missing_workbook = []

    for city_name in cities:
        city_folder = find_city_folder(root_path, city_name)
        if not city_folder:
            missing.append(city_name)
            continue

        workbook = choose_workbook(city_folder, city_name)
        source_id = slugify(city_name)
        existing_entry = existing_by_id.get(source_id, {})
        active = True if not isinstance(existing_entry, dict) else bool(existing_entry.get("active", True))

        row = {
            "id": source_id,
            "city": city_name,
            "workbookPath": str(workbook) if workbook else "",
            "worksheetName": "",
            "imagesRootPath": str(city_folder),
            "active": active,
        }
        if not workbook:
            missing_workbook.append(city_name)
        result.append(row)

    result.sort(key=lambda item: item["city"].lower())
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")

    print(f"city-sources.json rebuilt. {len(result)} city source(s) written.")
    if missing:
        print(f"  Missing city folder(s): {', '.join(missing)}")
    if missing_workbook:
        print(f"  Missing workbook(s): {', '.join(missing_workbook)}")


if __name__ == "__main__":
    main()
