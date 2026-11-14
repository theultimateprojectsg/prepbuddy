# Draws the question pictures as small JPEGs (data URIs). Run with python3 -I.
import io, base64, sys
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon, Rectangle, FancyArrowPatch

INK = '#1E2A5A'; FILL = '#DCE6FB'; ACC = '#26357A'

def _out(fig):
    b = io.BytesIO(); fig.savefig(b, format='jpeg', dpi=110, bbox_inches='tight', pad_inches=0.15, pil_kwargs={'quality': 82}); plt.close(fig)
    return 'data:image/jpeg;base64,' + base64.b64encode(b.getvalue()).decode()

def bar_chart(title, cats, vals, step, ymax, ylabel, horizontal=False, unit_note=None):
    fig, ax = plt.subplots(figsize=(5.2, 3.4))
    if horizontal:
        ax.barh(cats, vals, color=FILL, edgecolor=ACC, height=0.55)
        ax.set_xlim(0, ymax); ax.set_xticks(range(0, ymax + 1, step)); ax.grid(axis='x', color='#c9d2e6', lw=0.8); ax.set_xlabel(ylabel)
        ax.invert_yaxis()
    else:
        ax.bar(cats, vals, color=FILL, edgecolor=ACC, width=0.55)
        ax.set_ylim(0, ymax); ax.set_yticks(range(0, ymax + 1, step)); ax.grid(axis='y', color='#c9d2e6', lw=0.8); ax.set_ylabel(ylabel)
    ax.set_axisbelow(True); ax.set_title(title, fontsize=11, color=INK, fontweight='bold')
    for s in ('top', 'right'): ax.spines[s].set_visible(False)
    ax.tick_params(colors=INK, labelsize=9)
    return _out(fig)

def rect_shape(pts, labels, title=None, grid=False, size=(4.2, 3.2), shade=None):
    """pts: polygon corners; labels: list of (x, y, text)."""
    fig, ax = plt.subplots(figsize=size)
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    if grid:
        for x in range(int(min(xs)) - 1, int(max(xs)) + 2): ax.plot([x, x], [min(ys) - 1, max(ys) + 1], color='#d5dcec', lw=0.7, zorder=0)
        for y in range(int(min(ys)) - 1, int(max(ys)) + 2): ax.plot([min(xs) - 1, max(xs) + 1], [y, y], color='#d5dcec', lw=0.7, zorder=0)
    ax.add_patch(Polygon(pts, closed=True, facecolor=FILL, edgecolor=ACC, lw=2))
    if shade: ax.add_patch(Polygon(shade, closed=True, facecolor='white', edgecolor=ACC, lw=1.6, hatch=None))
    for x, y, t in labels: ax.text(x, y, t, ha='center', va='center', fontsize=10, color=INK)
    ax.set_xlim(min(xs) - 1.2, max(xs) + 1.2); ax.set_ylim(min(ys) - 1.0, max(ys) + 1.0)
    ax.set_aspect('equal'); ax.axis('off')
    if title: ax.set_title(title, fontsize=10, color=INK)
    return _out(fig)

def shapes_row(shapes):
    """shapes: list of (label, points). Drawn side by side."""
    fig, axs = plt.subplots(1, len(shapes), figsize=(2.1 * len(shapes), 2.4))
    for ax, (lab, pts) in zip(axs, shapes):
        ax.add_patch(Polygon(pts, closed=True, facecolor=FILL, edgecolor=ACC, lw=1.8))
        ax.set_xlim(-0.4, 3.4); ax.set_ylim(-0.6, 3.0); ax.set_aspect('equal'); ax.axis('off')
        ax.text(1.5, -0.4, lab, ha='center', va='center', fontsize=20, color=INK, fontweight='bold')
    return _out(fig)

def grid_map(places, w=8, h=6, start=None):
    """places: list of (x, y, name). North at the top."""
    fig, ax = plt.subplots(figsize=(4.6, 3.8))
    for x in range(w + 1): ax.plot([x, x], [0, h], color='#d5dcec', lw=0.7)
    for y in range(h + 1): ax.plot([0, w], [y, y], color='#d5dcec', lw=0.7)
    for x, y, n in places:
        ax.plot(x, y, 'o', color=ACC, ms=7)
        ax.text(x, y + 0.32, n, ha='center', va='bottom', fontsize=9, color=INK, bbox=dict(facecolor='white', edgecolor='none', pad=0.5))
    ax.annotate('', xy=(w + 0.7, h - 0.2), xytext=(w + 0.7, h - 1.3), arrowprops=dict(arrowstyle='-|>', color=INK, lw=1.6))
    ax.text(w + 0.7, h + 0.05, 'N', ha='center', va='bottom', fontsize=11, color=INK, fontweight='bold')
    ax.set_xlim(-0.4, w + 1.2); ax.set_ylim(-0.4, h + 0.6); ax.set_aspect('equal'); ax.axis('off')
    return _out(fig)

def dissect_square():
    fig, ax = plt.subplots(figsize=(2.6, 2.6))
    ax.add_patch(Polygon([(0, 0), (4, 0), (4, 4), (0, 4)], closed=True, facecolor=FILL, edgecolor=ACC, lw=2))
    ax.plot([0, 4], [0, 4], color=ACC, lw=1.6, ls='--'); ax.plot([0, 4], [4, 0], color=ACC, lw=1.6, ls='--')
    ax.text(2, -0.45, 'A square is cut along the two dashed lines.', ha='center', fontsize=8, color=INK)
    ax.set_xlim(-0.4, 4.4); ax.set_ylim(-0.8, 4.4); ax.set_aspect('equal'); ax.axis('off')
    return _out(fig)
