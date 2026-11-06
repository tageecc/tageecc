import argparse
from datetime import date
from html import escape
import json
import math
from pathlib import Path
import sys


def render(calendar, username):
    weeks = calendar["weeks"]
    days = [day for week in weeks for day in week["contributionDays"]]
    maximum = max(day["contributionCount"] for day in days)
    active = sum(day["contributionCount"] > 0 for day in days)
    first, last = days[0]["date"], days[-1]["date"]
    width = 900 / len(weeks)
    colors = ["#30204e", "#3a8dff", "#00e5d0", "#bc78ff", "#ff53aa"]
    svg = [f'''<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="510" viewBox="0 0 1200 510" role="img" aria-labelledby="title desc">
<title id="title">{escape(username)} — 3D contribution city</title>
<desc id="desc">{calendar["totalContributions"]:,} contributions from {first} to {last}. One building per day; height is proportional to the square root of the contribution count.</desc>
<defs>
  <radialGradient id="sky" cx="65%" cy="40%" r="75%"><stop stop-color="#241039"/><stop offset="1" stop-color="#090312"/></radialGradient>
  <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>
  <linearGradient id="edge"><stop stop-color="#ff53aa"/><stop offset="1" stop-color="#00e5d0"/></linearGradient>
  <style>
    text {{ font: 16px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; fill: #c9b5e0; }}
    .heading {{ font: 700 32px Helvetica, Arial, sans-serif; fill: #f6ecff; letter-spacing: 1px; }}
    .roof {{ animation: light 6s ease-in-out infinite; }}
    @keyframes light {{ 0%, 100% {{ opacity: 1; }} 50% {{ opacity: .7; }} }}
    @media (prefers-reduced-motion: reduce) {{ .roof {{ animation: none; }} }}
  </style>
</defs>
<rect width="1200" height="510" rx="12" fill="url(#sky)"/>
<text class="heading" x="42" y="54">CONTRIBUTION CITY</text>
<text x="42" y="84">{escape(username)} / {first} — {last}</text>
<text x="1158" y="54" text-anchor="end" fill="#00e5d0">{calendar["totalContributions"]:,} contributions · {active} active days</text>''']

    def project(week, weekday, height=0):
        return 120 + week * width + weekday * 14, 333 - week * 2.1 + weekday * 11 - height

    def polygon(points, attributes):
        coords = " ".join(f"{x:.2f},{y:.2f}" for x, y in points)
        svg.append(f'<polygon points="{coords}" {attributes}/>')

    def line(start, end, attributes):
        svg.append(f'<line x1="{start[0]:.2f}" y1="{start[1]:.2f}" x2="{end[0]:.2f}" y2="{end[1]:.2f}" {attributes}/>')

    corners = [project(-0.4, -0.4), project(len(weeks) + 0.4, -0.4), project(len(weeks) + 0.4, 7.4), project(-0.4, 7.4)]
    polygon([(x + 8, y + 19) for x, y in corners], 'fill="#000" opacity=".6" filter="url(#shadow)"')
    polygon(corners, 'fill="#10091f" stroke="url(#edge)" stroke-width="1.2"')
    for week in range(len(weeks) + 1):
        line(project(week, 0), project(week, 7), 'stroke="#322040" stroke-width=".65"')
    for weekday in range(8):
        line(project(0, weekday), project(len(weeks), weekday), 'stroke="#322040" stroke-width=".65"')

    buildings = []
    for week, column in enumerate(weeks):
        for day in column["contributionDays"]:
            weekday = (date.fromisoformat(day["date"]).weekday() + 1) % 7
            buildings.append((week, weekday, day))

    # Paint back-to-front so taller buildings occlude those behind them.
    buildings.sort(key=lambda item: project(item[0], item[1])[1])
    for week, weekday, day in buildings:
        count = day["contributionCount"]
        height = 4 + 125 * math.sqrt(count / maximum) if count else 0
        tier = 0 if count == 0 else 1 if count <= 10 else 2 if count <= 40 else 3 if count <= 120 else 4
        color = colors[tier]
        a, b, c, d = [project(w, y) for w, y in [(week + .12, weekday + .12), (week + .84, weekday + .12), (week + .84, weekday + .84), (week + .12, weekday + .84)]]
        at, bt, ct, dt = [(x, y - height) for x, y in [a, b, c, d]]
        svg.append(f'<g data-date="{day["date"]}" data-count="{count}"><title>{day["date"]}: {count} contributions</title>')
        if count:
            polygon([d, c, ct, dt], f'fill="{color}" fill-opacity=".3" stroke="{color}" stroke-opacity=".55" stroke-width=".55"')
            polygon([b, c, ct, bt], f'fill="{color}" fill-opacity=".5" stroke="{color}" stroke-opacity=".7" stroke-width=".55"')
            for level in range(10, int(height), 12):
                line((d[0], d[1] - level), (c[0], c[1] - level), f'stroke="{color}" stroke-opacity=".55" stroke-width=".7"')
                line((b[0], b[1] - level), (c[0], c[1] - level), f'stroke="{color}" stroke-opacity=".35" stroke-width=".7"')
        polygon([at, bt, ct, dt], f'fill="{color}" stroke="{color if count else "#423051"}" stroke-width=".65"' + (' class="roof"' if count > 120 else ''))
        svg.append('</g>')

    previous = None
    for week, column in enumerate(weeks):
        month = column["contributionDays"][0]["date"][:7]
        if month != previous:
            x, y = project(week, 8.9)
            label = date.fromisoformat(column["contributionDays"][0]["date"]).strftime("%b")
            svg.append(f'<text x="{x:.2f}" y="{y:.2f}" font-size="14">{label}</text>')
            previous = month

    for weekday, label in [(1, "Mon"), (3, "Wed"), (5, "Fri")]:
        x, y = project(-3, weekday + .65)
        svg.append(f'<text x="{x:.2f}" y="{y:.2f}" font-size="13">{label}</text>')

    svg.append('<path d="M42 460 H1158" stroke="#332044"/>')
    svg.append('<text x="42" y="490" font-size="13">One block = one day · Height ∝ √contributions</text>')
    for index, label in enumerate(["0", "1–10", "11–40", "41–120", "121+"]):
        x = 666 + index * 101
        svg.append(f'<rect x="{x}" y="477" width="12" height="12" rx="2" fill="{colors[index]}"/>')
        svg.append(f'<text x="{x + 18}" y="488" font-size="13">{label}</text>')
    svg.append('</svg>')
    return "\n".join(svg) + "\n"


def render_stl(calendar):
    triangles = []

    def box(x0, y0, z0, x1, y1, z1):
        vertices = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
                    (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
        faces = [((0, 0, -1), (0, 3, 2, 1)), ((0, 0, 1), (4, 5, 6, 7)),
                 ((0, -1, 0), (0, 1, 5, 4)), ((1, 0, 0), (1, 2, 6, 5)),
                 ((0, 1, 0), (2, 3, 7, 6)), ((-1, 0, 0), (3, 0, 4, 7))]
        for normal, corners in faces:
            for indices in [(corners[0], corners[1], corners[2]), (corners[0], corners[2], corners[3])]:
                points = "\n".join("vertex " + " ".join(f"{value:g}" for value in vertices[index]) for index in indices)
                triangles.append(f'facet normal {normal[0]} {normal[1]} {normal[2]}\nouter loop\n{points}\nendloop\nendfacet')

    weeks = calendar["weeks"]
    maximum = max(day["contributionCount"] for week in weeks for day in week["contributionDays"])
    box(-1, -1, -1, len(weeks) * 3, 21, 0)
    for week, column in enumerate(weeks):
        for day in column["contributionDays"]:
            weekday = (date.fromisoformat(day["date"]).weekday() + 1) % 7
            count = day["contributionCount"]
            height = round(1 + 28 * math.sqrt(count / maximum), 1) if count else .4
            x, y = week * 3, (6 - weekday) * 3
            box(x, y, 0, x + 2, y + 2, height)
    return "solid contribution_city\n" + "\n".join(triangles) + "\nendsolid contribution_city\n"


def embed_stl(readme, stl):
    start, end = "<!-- contribution-city:start -->", "<!-- contribution-city:end -->"
    if readme.count(start) != 1 or readme.count(end) != 1:
        raise ValueError("README must contain exactly one contribution-city marker pair")
    before, _, remaining = readme.partition(start)
    _, separator, after = remaining.partition(end)
    if not separator:
        raise ValueError("Contribution-city markers are out of order")
    updated = f"{before}{start}\n\n```stl\n{stl}```\n\n{end}{after}"
    if len(updated.encode("utf-8")) > 480 * 1024:
        raise ValueError("Generated README exceeds the 480 KiB safety budget")
    return updated


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--username", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--stl-output", type=Path)
    parser.add_argument("--readme", type=Path)
    args = parser.parse_args()
    if args.readme and not args.stl_output:
        parser.error("--readme requires --stl-output")
    calendar = json.load(sys.stdin)
    svg = render(calendar, args.username)
    stl = render_stl(calendar) if args.stl_output else None
    readme = embed_stl(args.readme.read_text(encoding="utf-8"), stl) if args.readme else None
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(svg, encoding="utf-8")
    if args.stl_output:
        args.stl_output.parent.mkdir(parents=True, exist_ok=True)
        args.stl_output.write_text(stl, encoding="ascii")
    if args.readme:
        args.readme.write_text(readme, encoding="utf-8")
