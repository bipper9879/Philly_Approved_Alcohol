import argparse
import csv
import json
from datetime import datetime, timezone
from pathlib import Path

REQUIRED_COLUMNS = ["Post", "Remove", "job#", "Campaign", "Market/Borough"]


def normalize_text(value: str) -> str:
    return (value or "").strip()


def normalize_date(raw: str):
    text = normalize_text(raw)
    if not text:
        return None, None

    # Primary input format from source sheet
    for fmt in ("%m/%d/%Y", "%m/%d/%y", "%Y-%m-%d"):
        try:
            parsed = datetime.strptime(text, fmt)
            return parsed.strftime("%Y-%m-%d"), parsed.strftime("%m/%d/%Y")
        except ValueError:
            continue

    raise ValueError(f"Unsupported date format '{text}'. Expected MM/DD/YYYY.")


def find_header_map(headers):
    by_lower = {str(h).strip().lower(): h for h in headers if h is not None}
    resolved = {}
    missing = []
    for required in REQUIRED_COLUMNS:
        match = by_lower.get(required.lower())
        if not match:
            missing.append(required)
        else:
            resolved[required] = match
    if missing:
        raise RuntimeError(
            "CSV is missing required column(s): " + ", ".join(missing)
        )
    return resolved


def parse_rows(csv_path: Path):
    with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames:
            raise RuntimeError("CSV has no header row.")

        header_map = find_header_map(reader.fieldnames)
        jobs = []

        for row_index, row in enumerate(reader, start=2):
            job_number = normalize_text(row.get(header_map["job#"], ""))
            if not job_number:
                # Allow blank lines without failing the full import.
                if not any(normalize_text(value) for value in row.values()):
                    continue
                raise RuntimeError(f"Row {row_index}: job# is required.")

            post_iso, post_display = normalize_date(row.get(header_map["Post"], ""))
            remove_iso, remove_display = normalize_date(row.get(header_map["Remove"], ""))

            city = normalize_text(row.get(header_map["Market/Borough"], ""))
            if not city:
                raise RuntimeError(f"Row {row_index}: Market/Borough is required.")

            campaign = normalize_text(row.get(header_map["Campaign"], ""))

            attributes = {}
            for key, value in row.items():
                if key in header_map.values():
                    continue
                clean_value = normalize_text(value)
                if clean_value:
                    attributes[key] = clean_value

            job = {
                "jobNumber": job_number,
                "postDate": post_iso,
                "removeDate": remove_iso,
                "postDateDisplay": post_display,
                "removeDateDisplay": remove_display,
                "campaign": campaign,
                "city": city,
                "sourceFields": {
                    "Post": normalize_text(row.get(header_map["Post"], "")),
                    "Remove": normalize_text(row.get(header_map["Remove"], "")),
                    "job#": job_number,
                    "Campaign": campaign,
                    "Market/Borough": city,
                },
            }

            if attributes:
                job["attributes"] = attributes

            jobs.append(job)

    return jobs


def main():
    parser = argparse.ArgumentParser(description="Build data/job-catalog.json from CSV source")
    parser.add_argument("--csv-path", required=True, help="Path to CSV with job catalog rows")
    parser.add_argument(
        "--repo-root",
        default=str(Path(__file__).resolve().parent.parent),
        help="Repository root path",
    )
    parser.add_argument(
        "--output",
        default="data/job-catalog.json",
        help="Output path relative to repo root or absolute path",
    )
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    csv_path = Path(args.csv_path).resolve()
    output_path = Path(args.output)
    if not output_path.is_absolute():
        output_path = (repo_root / output_path).resolve()

    if not csv_path.exists():
        raise FileNotFoundError(f"CSV file not found: {csv_path}")

    jobs = parse_rows(csv_path)

    payload = {
        "version": 1,
        "dateDisplayFormat": "MM/DD/YYYY",
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "source": {
            "type": "csv",
            "path": str(csv_path),
        },
        "jobs": jobs,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    print(f"job-catalog.json rebuilt. {len(jobs)} jobs written.")


if __name__ == "__main__":
    main()


