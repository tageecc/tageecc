import argparse
from datetime import date
from html import escape
import json
import math
from pathlib import Path
import sys


COLORS = ["#2d333b", "#065f46", "#059669", "#10b981", "#34d399"]
FACES = [([4, 5, 6, 7], 1, (0, 0, 1)), ([3, 2, 1, 0], .4, (0, 0, -1)),
         ([3, 0, 4, 7], .55, (-1, 0, 0)), ([1, 2, 6, 5], .75, (1, 0, 0)),
         ([0, 1, 5, 4], .85, (0, -1, 0)), ([2, 3, 7, 6], .65, (0, 1, 0))]


def rotate(x, y, z, yaw=-.2, pitch=.88):
    x1 = x * math.cos(yaw) - y * math.sin(yaw)
    y1 = x * math.sin(yaw) + y * math.cos(yaw)
    return x1, y1 * math.cos(pitch) - z * math.sin(pitch), y1 * math.sin(pitch) + z * math.cos(pitch)


def shade(hex_color, factor):
    channels = [min(255, max(0, round(int(hex_color[index:index + 2], 16) * factor))) for index in (1, 3, 5)]
    return "rgb(" + ",".join(map(str, channels)) + ")"


def render(calendar, username):
    weeks = calendar["weeks"]
    days = [day for week in weeks for day in week["contributionDays"]]
    cells = []
    for column, week in enumerate(weeks):
        for day in week["contributionDays"]:
            row = (date.fromisoformat(day["date"]).weekday() + 1) % 7
            count = day["contributionCount"]
            level = 0 if count == 0 else 1 if count <= 10 else 2 if count <= 40 else 3 if count <= 120 else 4
            height = max(1.8, level / 4 * 38)
            x, y, half = (column - len(weeks) / 2) * 13, (row - 3.5) * 13, 5.6
            vertices = [rotate(*point) for point in [(x-half, y-half, 0), (x+half, y-half, 0),
                        (x+half, y+half, 0), (x-half, y+half, 0), (x-half, y-half, height),
                        (x+half, y-half, height), (x+half, y+half, height), (x-half, y+half, height)]]
            cells.append((rotate(x, y, height / 2)[2], day, level, vertices))
    points = [point for _, _, _, vertices in cells for point in vertices]
    min_x, max_x = min(p[0] for p in points), max(p[0] for p in points)
    min_y, max_y = min(p[1] for p in points), max(p[1] for p in points)
    scale = min(1100 / (max_x - min_x), 220 / (max_y - min_y))
    tx, ty = 600 - (min_x + max_x) / 2 * scale, 181 - (min_y + max_y) / 2 * scale
    active = sum(day["contributionCount"] > 0 for day in days)
    svg = [f'''<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="360" viewBox="0 0 1200 360" role="img" aria-labelledby="title desc">
<title id="title">{escape(username)} — 3D contribution activity</title>
<desc id="desc">{calendar["totalContributions"]:,} GitHub contributions from {days[0]["date"]} to {days[-1]["date"]}. One solid voxel per day; its height and shade show the activity level. Static preview.</desc>
<rect width="1200" height="360" rx="8" fill="#0b1015"/>
<g fill="#a3b4c5" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="13">
<text x="36" y="34">{escape(username)} / {days[0]["date"]} — {days[-1]["date"]}</text>
<text x="1164" y="34" text-anchor="end">{calendar["totalContributions"]:,} contributions · {active} active days</text>
</g>
<g transform="translate({tx:.3f} {ty:.3f}) scale({scale:.5f})">''']
    for _, day, level, vertices in sorted(cells, key=lambda cell: cell[0]):
        svg.append(f'<g data-date="{day["date"]}" data-count="{day["contributionCount"]}"><title>{day["date"]}: {day["contributionCount"]} contributions</title>')
        for indices, face_scale, normal in FACES:
            nx, ny, nz = rotate(*normal)
            if nz <= .001:
                continue
            factor = face_scale * (.82 + .28 * max(0, nx * .35 - ny * .4 + nz * .83)) + .18
            color = shade(COLORS[level], factor)
            path = " ".join(f'{"M" if index == 0 else "L"}{vertices[vertex][0]:.3f},{vertices[vertex][1]:.3f}' for index, vertex in enumerate(indices)) + " Z"
            svg.append(f'<path d="{path}" fill="{color}" stroke="{color}" stroke-width=".25" stroke-linejoin="round"/>')
        svg.append('</g>')
    svg.append('</g><path d="M36 306 H1164" stroke="#21313b"/>')
    svg.append('<g fill="#a3b4c5" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="12"><text x="36" y="337">One block = one day · Height = activity level</text>')
    for index, label in enumerate(["0", "1–10", "11–40", "41–120", "121+"]):
        x = 704 + index * 94
        svg.append(f'<rect x="{x}" y="325" width="11" height="11" rx="2" fill="{COLORS[index]}"/><text x="{x + 18}" y="336">{label}</text>')
    svg.append('</g></svg>')
    return "\n".join(svg) + "\n"


def render_stl(calendar):
    facets = []
    days = [day for week in calendar["weeks"] for day in week["contributionDays"]]
    # Limit beveled peaks to keep the inline model within GitHub's README size budget.
    beveled = {day["date"] for day in sorted(days, key=lambda day: day["contributionCount"], reverse=True)[:8]
               if day["contributionCount"] > 40}

    def number(value):
        formatted = f"{value:.5f}".rstrip("0").rstrip(".") if value else "0"
        return formatted.replace("-0.", "-.") if formatted.startswith("-0.") else formatted[1:] if formatted.startswith("0.") else formatted

    def triangle(a, b, c):
        # Small units keep the native viewer's fixed-spacing grid from becoming a dense black plane.
        a, b, c = [((4*x - 3*y) / 10, (3*x + 4*y) / 10, z / 2) for x, y, z in (a, b, c)]
        u, v = [b[i] - a[i] for i in range(3)], [c[i] - a[i] for i in range(3)]
        normal = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
        length = math.sqrt(sum(value * value for value in normal))
        direction = " ".join(number(value / length) for value in normal)
        vertices = "\n".join("vertex " + " ".join(number(value) for value in point) for point in (a, b, c))
        facets.append(f"facet normal {direction}\nouter loop\n{vertices}\nendloop\nendfacet")

    def quad(a, b, c, d):
        triangle(a, b, c)
        triangle(a, c, d)

    for column, week in enumerate(calendar["weeks"]):
        for day in week["contributionDays"]:
            row = (date.fromisoformat(day["date"]).weekday() + 1) % 7
            count = day["contributionCount"]
            level = 0 if count == 0 else 1 if count <= 10 else 2 if count <= 40 else 3 if count <= 120 else 4
            height = max(2, level * 10)
            x, y = column * 14, (6 - row) * 14
            profiles = [(0, 6), (height - 1, 6), (height, 5)] if day["date"] in beveled else [(0, 6), (height, 6)]
            rings = [[(x - half, y - half, z), (x + half, y - half, z),
                      (x + half, y + half, z), (x - half, y + half, z)] for z, half in profiles]
            quad(*reversed(rings[0]))
            for bottom, top in zip(rings, rings[1:]):
                for index in range(4):
                    following = (index + 1) % 4
                    quad(bottom[index], bottom[following], top[following], top[index])
            quad(*rings[-1])
    return "solid contribution_heatmap\n" + "\n".join(facets) + "\nendsolid contribution_heatmap\n"


def embed_stl(readme, stl):
    start, end = "<!-- contribution-stl:start -->", "<!-- contribution-stl:end -->"
    if readme.count(start) != 1 or readme.count(end) != 1:
        raise ValueError("README must contain exactly one contribution-stl marker pair")
    before, _, remaining = readme.partition(start)
    _, separator, after = remaining.partition(end)
    if not separator:
        raise ValueError("Contribution-stl markers are out of order")
    updated = f"{before}{start}\n\n```stl\n{stl}```\n\n{end}{after}"
    if len(updated.encode("utf-8")) > 498 * 1024:
        raise ValueError("Generated README exceeds the 498 KiB safety budget")
    return updated


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--username", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--json-output", type=Path, required=True)
    parser.add_argument("--stl-output", type=Path)
    parser.add_argument("--readme", type=Path)
    args = parser.parse_args()
    if args.readme and not args.stl_output:
        parser.error("--readme requires --stl-output")
    calendar = json.load(sys.stdin)
    svg = render(calendar, args.username)
    data = json.dumps({"username": args.username, **calendar}, separators=(",", ":")) + "\n"
    stl = render_stl(calendar) if args.stl_output else None
    readme = embed_stl(args.readme.read_text(encoding="utf-8"), stl) if args.readme else None
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.json_output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(svg, encoding="utf-8")
    args.json_output.write_text(data, encoding="utf-8")
    if args.stl_output:
        args.stl_output.parent.mkdir(parents=True, exist_ok=True)
        args.stl_output.write_text(stl, encoding="ascii")
    if args.readme:
        args.readme.write_text(readme, encoding="utf-8")
