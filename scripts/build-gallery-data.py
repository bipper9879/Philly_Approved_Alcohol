import argparse
import json
import re
from pathlib import Path
from urllib.parse import quote

from openpyxl import load_workbook


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}


def normalize_location_key(value: str) -> str:
    text = (value or "").strip().lower()
    text = text.replace("&", " and ")
    return re.sub(r"[^a-z0-9]", "", text)


def to_text(value) -> str:
    if value is None:
        return ""
    return str(value).strip()


def parse_number(value):
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def find_header_row(ws):
    max_scan = min(100, ws.max_row or 100)
    for row in range(1, max_scan + 1):
        site_code = to_text(ws.cell(row=row, column=1).value)
        location = to_text(ws.cell(row=row, column=3).value)
        if site_code.lower() == "site code" and location.lower() == "location":
            return row
    raise RuntimeError("Could not find header row containing 'Site Code' and 'Location'.")


def read_workbook_metadata(workbook_path: Path, worksheet_name: str):
    wb = load_workbook(workbook_path, data_only=True, read_only=True)
    try:
        ws = wb[worksheet_name] if worksheet_name else wb.worksheets[0]
        header_row = find_header_row(ws)
        filter_label = to_text(ws.cell(row=header_row, column=4).value) or "Column D"

        by_exact = {}
        by_normalized = {}

        for row in range(header_row + 1, (ws.max_row or header_row) + 1):
            site_code = to_text(ws.cell(row=row, column=1).value)
            if not re.fullmatch(r"PHI-[A-Fa-f0-9]+", site_code):
                continue

            location = to_text(ws.cell(row=row, column=3).value)
            if not location:
                continue

            col_d = parse_number(ws.cell(row=row, column=4).value)
            street_view = to_text(ws.cell(row=row, column=6).value) or None
            lat = parse_number(ws.cell(row=row, column=7).value)
            lon = parse_number(ws.cell(row=row, column=8).value)

            reviewer_eligible = bool(col_d is not None and col_d > 0 and col_d < 10)
            payload = {
                "siteCode": site_code,
                "streetViewUrl": street_view,
                "lat": lat,
                "lon": lon,
                "reviewerEligible": reviewer_eligible,
                "reviewerFilterLabel": filter_label,
                "reviewerFilterValue": col_d,
            }

            by_exact[location] = payload
            by_normalized[normalize_location_key(location)] = payload

        return by_exact, by_normalized
    finally:
        wb.close()


def build_locations(index_files_root: Path, by_exact, by_normalized):
    locations = []
    for folder in sorted([p for p in index_files_root.iterdir() if p.is_dir()], key=lambda p: p.name.lower()):
        images = []
        for file_path in sorted([f for f in folder.iterdir() if f.is_file()], key=lambda p: p.name.lower()):
            if file_path.suffix.lower() not in IMAGE_EXTENSIONS:
                continue
            images.append(
                {
                    "name": file_path.name,
                    "url": f"index_files/{quote(folder.name, safe='')}/{quote(file_path.name, safe='')}",
                }
            )

        cover_image_name = None
        if images:
            explicit_cover = next((img for img in images if img["name"].lower() == "cover.jpg"), None)
            cover_image_name = explicit_cover["name"] if explicit_cover else images[0]["name"]

        metadata = by_exact.get(folder.name) or by_normalized.get(normalize_location_key(folder.name), {})
        locations.append(
            {
                "siteCode": metadata.get("siteCode"),
                "streetViewUrl": metadata.get("streetViewUrl"),
                "lat": metadata.get("lat"),
                "lon": metadata.get("lon"),
                "reviewerEligible": bool(metadata.get("reviewerEligible")),
                "reviewerFilterLabel": metadata.get("reviewerFilterLabel"),
                "reviewerFilterValue": metadata.get("reviewerFilterValue"),
                "location": folder.name,
                "folderName": folder.name,
                "folderUrl": f"index_files/{quote(folder.name, safe='')}/",
                "coverImageName": cover_image_name,
                "images": images,
            }
        )

    return locations


def main():
    parser = argparse.ArgumentParser(description="Build gallery-data.json directly from workbook + image folders.")
    parser.add_argument("--workbook-path", required=True, help="Absolute path to workbook (.xlsx/.xlsm/.xls)")
    parser.add_argument("--worksheet-name", default="", help="Worksheet name (default: first worksheet)")
    parser.add_argument("--repo-root", default=str(Path(__file__).resolve().parent.parent), help="Repository root path")
    parser.add_argument("--email", default="bipper9879@hotmail.com", help="Email in gallery-data.json payload")
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    workbook_path = Path(args.workbook_path).resolve()
    index_files_root = repo_root / "index_files"
    output_path = repo_root / "gallery-data.json"

    if not workbook_path.exists():
        raise FileNotFoundError(f"Workbook file not found: {workbook_path}")
    if not index_files_root.exists():
        raise FileNotFoundError(f"Missing index_files folder: {index_files_root}")

    by_exact, by_normalized = read_workbook_metadata(workbook_path, args.worksheet_name)
    locations = build_locations(index_files_root, by_exact, by_normalized)

    payload = {
        "email": args.email,
        "issueUrlBase": "https://github.com/bipper9879/Philly_Approved_Alcohol/issues/new",
        "locations": locations,
    }

    output_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    matched = sum(1 for loc in locations if loc.get("siteCode"))
    unmatched = len(locations) - matched
    print(f"gallery-data.json rebuilt. {len(locations)} locations written.")
    print(f"  Site codes matched: {matched}  |  Unmatched: {unmatched}")
    if unmatched:
        for loc in locations:
            if not loc.get("siteCode"):
                print(f"  No site code: {loc['location']}")


if __name__ == "__main__":
    main()
