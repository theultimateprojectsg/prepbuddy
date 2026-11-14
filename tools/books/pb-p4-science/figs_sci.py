# Pictures for the P4 Science bank (small JPEG data URIs). Run with python3 -I.
import io, base64, math
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Circle, Rectangle, Wedge, Polygon

INK = '#1E2A5A'; FILL = '#DCE6FB'; ACC = '#26357A'; WARM = '#F5C542'

def _out(fig):
    b = io.BytesIO(); fig.savefig(b, format='jpeg', dpi=110, bbox_inches='tight', pad_inches=0.15, pil_kwargs={'quality': 82}); plt.close(fig)
    return 'data:image/jpeg;base64,' + base64.b64encode(b.getvalue()).decode()

def _battery(ax, x, y):
    ax.add_patch(Rectangle((x - 0.6, y - 0.25), 1.2, 0.5, facecolor='#EEF1FB', edgecolor=ACC, lw=1.6))
    ax.add_patch(Rectangle((x + 0.6, y - 0.1), 0.12, 0.2, facecolor=ACC, edgecolor=ACC))
    ax.text(x + 0.4, y, '+', ha='center', va='center', fontsize=11, color=INK, fontweight='bold')
    ax.text(x - 0.4, y, '−', ha='center', va='center', fontsize=11, color=INK, fontweight='bold')
    return (x - 0.6, y), (x + 0.72, y)  # negative end, positive end

def _bulb(ax, x, y, lit=False):
    ax.add_patch(Circle((x, y + 0.35), 0.32, facecolor=WARM if lit else 'white', edgecolor=ACC, lw=1.6))
    ax.add_patch(Rectangle((x - 0.17, y - 0.12), 0.34, 0.2, facecolor='#B8C1D9', edgecolor=ACC, lw=1.2))
    return (x - 0.17, y - 0.02), (x, y - 0.14)  # side contact, tip contact

def circuits():
    """Four circuits: 1 complete; 2 gap in a wire; 3 both wires on the same battery end; 4 open switch."""
    fig, axs = plt.subplots(2, 2, figsize=(5.6, 5.4))
    for k, ax in enumerate(axs.flat):
        ax.set_xlim(-1.6, 1.8); ax.set_ylim(-1.3, 1.5); ax.set_aspect('equal'); ax.axis('off')
        neg, pos = _battery(ax, 0, -0.8)
        side, tip = _bulb(ax, 0.1, 0.55)
        w = dict(color=ACC, lw=1.8)
        if k == 0:
            ax.plot([neg[0], -1.2, -1.2, side[0]], [neg[1], neg[1], side[1], side[1]], **w)
            ax.plot([pos[0], 1.3, 1.3, tip[0], tip[0]], [pos[1], pos[1], 0.2, 0.2, tip[1]], **w)
        elif k == 1:
            ax.plot([neg[0], -1.2, -1.2], [neg[1], neg[1], -0.05], **w)
            ax.plot([-1.2, -1.2, side[0]], [0.2, side[1], side[1]], **w)
            ax.plot([pos[0], 1.3, 1.3, tip[0], tip[0]], [pos[1], pos[1], 0.2, 0.2, tip[1]], **w)
        elif k == 2:
            ax.plot([pos[0], 1.3, 1.3, tip[0], tip[0]], [pos[1], pos[1], 0.2, 0.2, tip[1]], **w)
            ax.plot([pos[0] - 0.05, 1.05, 1.05, 0.45, side[0]], [pos[1] - 0.05, -0.55, 0.05, 0.45, side[1]], **w)
            ax.plot([neg[0], -1.2], [neg[1], neg[1]], color='white', lw=0)
        else:
            ax.plot([neg[0], -1.2, -1.2], [neg[1], neg[1], -0.35], **w)
            ax.plot([-1.2, -0.95], [-0.35, 0.05], **w)  # switch lever, open
            ax.plot(-1.2, -0.35, 'o', color=ACC, ms=4); ax.plot(-1.2, 0.1, 'o', color=ACC, ms=4)
            ax.plot([-1.2, -1.2, side[0]], [0.1, side[1], side[1]], **w)
            ax.plot([pos[0], 1.3, 1.3, tip[0], tip[0]], [pos[1], pos[1], 0.2, 0.2, tip[1]], **w)
        ax.text(0.1, -1.3, str(k + 1), ha='center', va='center', fontsize=16, color=INK, fontweight='bold')
    return _out(fig)

def earth_layers():
    fig, ax = plt.subplots(figsize=(3.6, 3.2))
    ax.add_patch(Wedge((0, 0), 3.0, 0, 90, facecolor='#C9B48A', edgecolor=ACC, lw=1.5))
    ax.add_patch(Wedge((0, 0), 2.8, 0, 90, facecolor='#F0A35E', edgecolor=ACC, lw=1.2))
    ax.add_patch(Wedge((0, 0), 1.3, 0, 90, facecolor='#E5533D', edgecolor=ACC, lw=1.2))
    for lab, (x, y), (tx, ty) in (('1', (2.05, 2.05), (3.0, 3.0)), ('2', (1.45, 1.45), (3.1, 1.6)), ('3', (0.55, 0.55), (2.3, 0.35))):
        ax.annotate(lab, xy=(x, y), xytext=(tx, ty), fontsize=14, color=INK, fontweight='bold', arrowprops=dict(arrowstyle='-', color=INK, lw=1.2))
    ax.text(0.1, -0.35, 'centre', fontsize=8, color=INK)
    ax.set_xlim(-0.3, 3.6); ax.set_ylim(-0.5, 3.4); ax.set_aspect('equal'); ax.axis('off')
    ax.set_title('Part of the inside of the Earth', fontsize=10, color=INK)
    return _out(fig)

def shadows():
    fig, ax = plt.subplots(figsize=(5.4, 2.4))
    ax.plot([-5, 5], [0, 0], color=INK, lw=1.4)
    ax.plot([0, 0], [0, 1.6], color='#7A5230', lw=4)  # a pole
    ax.plot([-4.2, 0], [0, 0], color='#555', lw=6, alpha=0.55); ax.text(-2.1, -0.38, 'X', ha='center', fontsize=13, color=INK, fontweight='bold')
    ax.plot([0, 0.6], [0.06, 0.06], color='#222', lw=6, alpha=0.75); ax.text(0.3, 0.32, 'Y', ha='center', fontsize=13, color=INK, fontweight='bold')
    ax.plot([0, 3.8], [-0.08, -0.08], color='#888', lw=6, alpha=0.55); ax.text(1.9, -0.45, 'Z', ha='center', fontsize=13, color=INK, fontweight='bold')
    ax.text(-4.9, 0.25, 'West', fontsize=10, color=INK); ax.text(4.2, 0.25, 'East', fontsize=10, color=INK)
    ax.text(0, 1.85, 'a pole', ha='center', fontsize=9, color=INK)
    ax.set_xlim(-5.2, 5.2); ax.set_ylim(-0.8, 2.2); ax.axis('off')
    ax.set_title('Three shadows of the same pole on one sunny day', fontsize=10, color=INK)
    return _out(fig)

def flower():
    fig, ax = plt.subplots(figsize=(3.0, 3.3))
    from matplotlib.patches import Ellipse
    for x, ang in ((-0.75, 25), (0.75, -25), (-0.55, 60), (0.55, -60)):
        ax.add_patch(Ellipse((x, 1.25), 1.1, 0.45, angle=ang, facecolor='#F7C6D9', edgecolor=ACC, lw=1.1))
    ax.add_patch(Polygon([(-0.18, 0.55), (0.18, 0.55), (0.25, 0.85), (0.08, 1.05), (0.06, 2.0), (-0.06, 2.0), (-0.08, 1.05), (-0.25, 0.85)], closed=True, facecolor='#9CCB8F', edgecolor=ACC, lw=1.2))
    for x in (-0.45, 0.45):
        ax.plot([x * 0.5, x], [1.0, 1.75], color=ACC, lw=1.2); ax.add_patch(Circle((x, 1.8), 0.09, facecolor=WARM, edgecolor=ACC))
    ax.plot([0, 0], [-0.6, 0.55], color='#4C8C3F', lw=3)
    for lab, xy, txy in (('P', (0.06, 1.95), (0.9, 2.45)), ('Q', (0.45, 1.8), (1.35, 1.9)), ('R', (0.0, 0.7), (1.1, 0.45))):
        ax.annotate(lab, xy=xy, xytext=txy, fontsize=13, color=INK, fontweight='bold', arrowprops=dict(arrowstyle='-', color=INK, lw=1))
    ax.set_xlim(-1.7, 1.8); ax.set_ylim(-0.7, 2.7); ax.set_aspect('equal'); ax.axis('off')
    return _out(fig)
