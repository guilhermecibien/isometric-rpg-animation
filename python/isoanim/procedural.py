"""Procedural 3D-skeleton → 2D isometric sprite generator (the demo character).

The character is posed in 3D, rotated to each of the 8 screen directions, projected with
the same 2:1 projection the runtime uses, and rasterised with Pillow. Because the feet are
placed from world-space gait maths, planted feet really are stationary in the world, which
gives ground-truth foot markers for the slide validator.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable

from PIL import Image, ImageDraw

from .common import DIRECTIONS_8, heading, project

Vec3 = tuple[float, float, float]  # body-local: (forward, lateral-right, up)

TILE_W, TILE_H, Z_SCALE = 64, 32, 40
FRAME_W, FRAME_H = 128, 128
PIVOT = (64, 90)
SS = 4  # supersampling factor

PALETTE = {
    "outline": (35, 28, 44),
    "skin": (240, 196, 160),
    "hair": (122, 70, 44),
    "tunic": (46, 142, 160),
    "tunic_dark": (34, 108, 126),
    "pants": (58, 62, 112),
    "boots": (88, 56, 40),
    "belt": (214, 168, 70),
    "steel": (214, 222, 232),
    "hilt": (150, 98, 52),
    "glow": (140, 200, 255),
    "eye": (30, 24, 36),
}

LEG = 0.40          # thigh and shin length
HIP_Z = 0.74
HIP_W = 0.10
SHOULDER_W = 0.21
TORSO = 0.30
ARM = 0.22          # upper arm and forearm length
HEAD_R = 0.24


@dataclass
class Part:
    a: Vec3
    b: Vec3
    r: float
    color: tuple[int, int, int]
    kind: str = "cap"        # "cap" capsule | "ball"
    tag: str = ""


@dataclass
class Pose:
    parts: list[Part] = field(default_factory=list)
    feet: dict[str, tuple[float, float, float, bool]] = field(default_factory=dict)  # id -> f,l,z,contact
    head: Vec3 = (0, 0, 1.3)
    glow: list[tuple[Vec3, float, float]] = field(default_factory=list)  # center, radius, alpha


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def smooth(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def ik2d(hip: tuple[float, float], foot: tuple[float, float], l1: float, l2: float) -> tuple[float, float]:
    """Two-bone IK in the (forward, up) plane; the knee bends toward +forward."""
    dx, dz = foot[0] - hip[0], foot[1] - hip[1]
    d = max(1e-6, math.hypot(dx, dz))
    d = min(d, l1 + l2 - 1e-5)
    ux, uz = dx / math.hypot(dx, dz), dz / math.hypot(dx, dz)
    a = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
    h = math.sqrt(max(0.0, l1 * l1 - a * a))
    return hip[0] + ux * a + (-uz) * h, hip[1] + uz * a + ux * h


@dataclass
class Rig:
    """Parameters of one frame of the body, in body-local space."""
    hip_f: float = 0.0
    hip_z: float = HIP_Z
    lean: float = 0.0               # torso pitch, radians, + = forward
    head_pitch: float = 0.0
    feet: dict[str, tuple[float, float, bool]] = field(default_factory=lambda: {"L": (0.03, 0.0, True), "R": (-0.03, 0.0, True)})
    arm_swing: dict[str, float] = field(default_factory=lambda: {"L": 0.0, "R": 0.0})   # shoulder pitch, + forward
    arm_bend: dict[str, float] = field(default_factory=lambda: {"L": 0.25, "R": 0.25})  # elbow flexion
    arm_out: dict[str, float] = field(default_factory=lambda: {"L": 0.12, "R": 0.12})   # abduction
    sword: tuple[float, float] | None = (-0.5, 0.0)                                      # pitch from forward, lateral lean
    fall: float = 0.0               # rigid rotation backwards about the feet (death)
    glow_at: str | None = None


def build_pose(rig: Rig) -> Pose:
    pose = Pose()
    c = PALETTE
    lean = rig.lean
    hip = (rig.hip_f, 0.0, rig.hip_z)
    chest = (hip[0] + math.sin(lean) * TORSO, 0.0, hip[2] + math.cos(lean) * TORSO)
    neck = (chest[0] + math.sin(lean) * 0.06, 0.0, chest[2] + math.cos(lean) * 0.06)
    hp = lean + rig.head_pitch
    head = (neck[0] + math.sin(hp) * (HEAD_R + 0.02), 0.0, neck[2] + math.cos(hp) * (HEAD_R + 0.02))

    sign = {"L": -1.0, "R": 1.0}  # lateral: right = +
    out: list[Part] = []

    # legs
    for side in ("L", "R"):
        ff, fz, contact = rig.feet[side]
        s = sign[side]
        hip_j = (hip[0], s * HIP_W, hip[2])
        knee2 = ik2d((hip_j[0], hip_j[2]), (ff, fz + 0.07), LEG, LEG)
        knee = (knee2[0], s * HIP_W, knee2[1])
        ankle = (ff, s * HIP_W, fz + 0.07)
        toe = (ff + 0.11, s * HIP_W, fz + 0.04)
        out.append(Part(hip_j, knee, 0.078, c["pants"], tag=f"thigh{side}"))
        out.append(Part(knee, ankle, 0.07, c["pants"], tag=f"shin{side}"))
        out.append(Part((ankle[0] - 0.01, ankle[1], ankle[2] - 0.01), toe, 0.082, c["boots"], tag=f"boot{side}"))
        pose.feet[side] = (ff, s * HIP_W, fz, contact)

    # torso
    out.append(Part(hip, chest, 0.15, c["tunic"], tag="torso"))
    out.append(Part((hip[0] + 0.0, 0, hip[2] + 0.02), (hip[0] + math.sin(lean) * 0.05, 0, hip[2] + 0.02 + math.cos(lean) * 0.05), 0.158, c["belt"], tag="belt"))

    # arms
    hands: dict[str, Vec3] = {}
    for side in ("L", "R"):
        s = sign[side]
        sh = (chest[0] - math.sin(lean) * 0.03, s * SHOULDER_W, chest[2] - 0.04)
        sw, bend, ab = rig.arm_swing[side], rig.arm_bend[side], rig.arm_out[side]
        ua = (math.sin(sw) * ARM, s * math.sin(ab) * ARM, -math.cos(sw) * math.cos(ab) * ARM)
        el = (sh[0] + ua[0], sh[1] + ua[1], sh[2] + ua[2])
        fa_pitch = sw + bend
        fa = (math.sin(fa_pitch) * ARM, s * math.sin(ab * 0.6) * ARM, -math.cos(fa_pitch) * ARM)
        hand = (el[0] + fa[0], el[1] + fa[1], el[2] + fa[2])
        hands[side] = hand
        out.append(Part(sh, el, 0.064, c["tunic_dark"], tag=f"uarm{side}"))
        out.append(Part(el, hand, 0.056, c["skin"], tag=f"farm{side}"))
        out.append(Part(hand, hand, 0.068, c["skin"], kind="ball", tag=f"hand{side}"))

    if rig.sword is not None:
        pitch, lat = rig.sword
        hand = hands["R"]
        d = (math.cos(pitch), lat, math.sin(pitch))
        n = math.sqrt(sum(v * v for v in d))
        d = (d[0] / n, d[1] / n, d[2] / n)
        guard = (hand[0] + d[0] * 0.05, hand[1] + d[1] * 0.05, hand[2] + d[2] * 0.05)
        tip = (hand[0] + d[0] * 0.62, hand[1] + d[1] * 0.62, hand[2] + d[2] * 0.62)
        out.append(Part((hand[0] - d[0] * 0.07, hand[1] - d[1] * 0.07, hand[2] - d[2] * 0.07), guard, 0.04, c["hilt"], tag="hilt"))
        out.append(Part(guard, tip, 0.036, c["steel"], tag="blade"))
    if rig.glow_at:
        pose.glow.append((hands[rig.glow_at], 0.2, 0.55))

    out.append(Part(neck, neck, 0.1, c["skin"], kind="ball", tag="neck"))
    pose.head = head
    pose.parts = out

    if rig.fall:
        _fall(pose, rig.fall)
    return pose


def _fall(pose: Pose, psi: float) -> None:
    """Rotate everything backward about the origin (feet), then rest on the ground."""
    cs, sn = math.cos(psi), math.sin(psi)

    def rot(p: Vec3) -> Vec3:
        f, l, z = p
        # shift forward as it falls so the body ends up centred over the pivot (stays inside the canvas)
        return (f * cs - z * sn + 0.62 * sn, l, f * sn + z * cs + 0.12 * sn)

    for p in pose.parts:
        p.a, p.b = rot(p.a), rot(p.b)
    pose.head = rot(pose.head)
    pose.glow = [(rot(c), r, a) for c, r, a in pose.glow]
    for k, (f, l, z, contact) in list(pose.feet.items()):
        rf = rot((f, l, z))
        pose.feet[k] = (rf[0], rf[1], rf[2], False)


# ---------------------------------------------------------------------------
# Animations: each returns a Rig for frame i of n
# ---------------------------------------------------------------------------

def _gait(i: int, n: int, stride: float, duty: float, lift: float, lean: float, bob: float, arm: float, bend: float) -> Rig:
    rig = Rig(lean=lean)
    u_l = i / n
    for side, off in (("L", 0.0), ("R", 0.5)):
        u = (u_l + off) % 1.0
        half = duty * stride / 2
        if u < duty:  # stance: foot travels backward at body speed
            f = half - stride * u
            z = 0.0
            contact = True
        else:         # swing: carry the foot forward, lifting it
            w = (u - duty) / (1 - duty)
            f = lerp(-half, half, smooth(w))
            z = lift * math.sin(math.pi * w)
            contact = False
        rig.feet[side] = (f, z, contact)
    # Pelvis is lowest in double support and highest at mid-stance (two bobs per cycle).
    rig.hip_z = HIP_Z - bob - bob * math.cos(4 * math.pi * (u_l - (1 - duty) / 4))
    swing_l = -arm * math.cos(2 * math.pi * u_l)   # left arm opposes left leg
    rig.arm_swing = {"L": swing_l, "R": -swing_l}
    rig.arm_bend = {"L": bend + 0.25 * max(0, swing_l), "R": bend + 0.25 * max(0, -swing_l)}
    rig.sword = (-0.9 + 0.15 * (-swing_l), 0.05)
    return rig


def anim_idle(i: int, n: int) -> Rig:
    t = 2 * math.pi * i / n
    rig = Rig()
    rig.hip_z = HIP_Z - 0.005 + 0.007 * math.sin(t)
    rig.lean = 0.01 + 0.015 * math.sin(t)
    rig.arm_swing = {"L": 0.04 * math.sin(t + 1), "R": -0.1 + 0.03 * math.sin(t)}
    rig.arm_out = {"L": 0.12 + 0.03 * math.sin(t), "R": 0.14}
    rig.sword = (-1.0, 0.04)
    return rig


def anim_walk(i: int, n: int) -> Rig:
    return _gait(i, n, stride=1.1, duty=0.625, lift=0.12, lean=0.06, bob=0.022, arm=0.55, bend=0.3)


def anim_run(i: int, n: int) -> Rig:
    rig = _gait(i, n, stride=1.9, duty=0.38, lift=0.2, lean=0.24, bob=0.04, arm=0.95, bend=1.05)
    rig.sword = (-0.6, 0.05)
    return rig


def anim_start_walk(i: int, n: int) -> Rig:
    t = smooth((i + 1) / n)
    rig = anim_idle(0, 8)
    rig.lean = lerp(0.01, 0.1, t)
    f_l = lerp(0.03, 0.18, math.sin(math.pi * min(1, t * 1.1)) * 0.0 + t * 0.5)
    rig.feet["L"] = (f_l, 0.0, True)
    rig.feet["R"] = (lerp(-0.03, -0.14, t), 0.0, True)
    rig.arm_swing = {"L": lerp(0, -0.25, t), "R": lerp(-0.1, 0.2, t)}
    return rig


def anim_stop_walk(i: int, n: int) -> Rig:
    t = smooth((i + 1) / n)
    rig = anim_idle(0, 8)
    rig.lean = lerp(0.1, 0.01, t)
    rig.feet["L"] = (lerp(0.18, 0.03, t), 0.0, True)
    rig.feet["R"] = (lerp(-0.14, -0.03, t), 0.0, True)
    rig.hip_z = HIP_Z - 0.03 * math.sin(math.pi * t)
    rig.arm_swing = {"L": lerp(-0.25, 0, t), "R": lerp(0.2, -0.1, t)}
    return rig


def anim_attack(i: int, n: int) -> Rig:
    # keyframes: windup, windup, swing, impact, follow, recover, idle-ish
    pitch = [2.2, 2.7, 1.2, 0.05, -0.7, -0.6, -0.9]
    lat = [0.1, 0.0, -0.1, -0.3, -0.45, -0.2, 0.05]
    lean = [-0.05, -0.2, 0.15, 0.3, 0.26, 0.15, 0.05]
    lunge = [0.0, 0.05, 0.6, 1.0, 1.0, 0.7, 0.0]
    k = min(i, 6)
    rig = Rig(lean=lean[k])
    lg = lunge[k]
    rig.feet["L"] = (lerp(0.03, 0.26, lg), 0.0, lg > 0.5)
    rig.feet["R"] = (lerp(-0.03, -0.16, lg), 0.0, lg > 0.5)
    rig.hip_z = HIP_Z - 0.06 * lg
    rig.hip_f = 0.05 * lg
    sp = pitch[k]
    rig.arm_swing = {"L": -0.3 + 0.4 * lg, "R": sp - 0.2}
    rig.arm_bend = {"L": 0.5, "R": 0.4}
    rig.arm_out = {"L": 0.25, "R": 0.05}
    rig.sword = (sp, lat[k])
    return rig


def anim_cast(i: int, n: int) -> Rig:
    t = i / max(1, n - 1)
    rise = smooth(t * 1.6)
    rig = Rig(lean=lerp(0.0, -0.08, rise) + (0.12 if 2 <= i <= 3 else 0.0))
    rig.feet["L"] = (0.12, 0.0, True)
    rig.feet["R"] = (-0.1, 0.0, True)
    rig.arm_swing = {"L": lerp(0.0, 1.9, rise), "R": -0.2}
    rig.arm_bend = {"L": 0.1, "R": 0.4}
    rig.arm_out = {"L": 0.1, "R": 0.15}
    rig.sword = (-1.1, 0.0)
    rig.glow_at = "L" if i >= 1 else None
    if i >= n - 1:
        rig.arm_swing["L"] = 0.6; rig.glow_at = None
    return rig


def anim_hit(i: int, n: int) -> Rig:
    amt = [0.7, 1.0, 0.4][min(i, 2)]
    rig = Rig(lean=-0.28 * amt)
    rig.head_pitch = -0.2 * amt
    rig.hip_z = HIP_Z - 0.03 * amt
    rig.feet["L"] = (0.1 * amt, 0.0, True)
    rig.feet["R"] = (-0.12 * amt, 0.0, True)
    rig.arm_swing = {"L": -0.7 * amt, "R": -0.5 * amt}
    rig.arm_out = {"L": 0.5 * amt, "R": 0.5 * amt}
    rig.sword = (-0.4, 0.2)
    return rig


def anim_death(i: int, n: int) -> Rig:
    t = i / max(1, n - 1)
    rig = Rig()
    stagger = smooth(min(1, t * 2.5))
    rig.lean = -0.2 * stagger
    rig.hip_z = HIP_Z - 0.1 * smooth(min(1, t * 2.0))
    rig.feet["L"] = (0.1, 0.0, True)
    rig.feet["R"] = (-0.12, 0.0, True)
    rig.arm_swing = {"L": -0.6 * stagger, "R": -0.9 * stagger}
    rig.arm_out = {"L": 0.5 * stagger + 0.1, "R": 0.5 * stagger + 0.1}
    rig.sword = (-0.5 - 0.8 * t, 0.3)
    rig.fall = (math.pi / 2 - 0.04) * smooth(max(0.0, (t - 0.15) / 0.85))
    return rig


@dataclass
class AnimSpec:
    key: str
    frames: int
    fps: int
    loop: bool
    fn: Callable[[int, int], Rig]
    stride: float | None = None   # world cells travelled per loop (locomotion only)
    events: list[tuple[int, str]] = field(default_factory=list)


ANIMATIONS: list[AnimSpec] = [
    AnimSpec("idle", 8, 6, True, anim_idle),
    AnimSpec("walk", 8, 10, True, anim_walk, stride=1.1, events=[(1, "footstep"), (5, "footstep")]),
    AnimSpec("run", 8, 14, True, anim_run, stride=1.9, events=[(1, "footstep"), (5, "footstep")]),
    AnimSpec("start_walk", 3, 12, False, anim_start_walk),
    AnimSpec("stop_walk", 3, 12, False, anim_stop_walk),
    AnimSpec("attack", 7, 14, False, anim_attack, events=[(3, "hit")]),
    AnimSpec("cast", 6, 10, False, anim_cast, events=[(3, "cast_release")]),
    AnimSpec("hit", 3, 12, False, anim_hit),
    AnimSpec("death", 6, 9, False, anim_death),
]


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------

def _to_world(p: Vec3, h: tuple[float, float]) -> tuple[float, float, float]:
    f, l, z = p
    right = (-h[1], h[0])
    return h[0] * f + right[0] * l, h[1] * f + right[1] * l, z


def _to_px(w: tuple[float, float, float], scale: int = 1) -> tuple[float, float]:
    sx, sy = project(w[0], w[1], w[2], TILE_W, TILE_H, Z_SCALE)
    return (PIVOT[0] + sx) * scale, (PIVOT[1] + sy) * scale


def _depth(w: tuple[float, float, float]) -> float:
    return w[0] + w[1] + 0.762 * w[2]  # distance along the view axis (bigger = nearer camera)


def foot_px(pose: Pose, direction: str) -> list[dict]:
    h = heading(direction)
    out = []
    for fid, (f, l, z, contact) in pose.feet.items():
        px = _to_px(_to_world((f, l, z), h))
        out.append({"id": fid, "x": round(px[0] - PIVOT[0], 3), "y": round(px[1] - PIVOT[1], 3), "contact": bool(contact)})
    return out


def render_pose(pose: Pose, direction: str) -> Image.Image:
    h = heading(direction)
    W, H = FRAME_W * SS, FRAME_H * SS
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    unit = Z_SCALE * SS * 0.95  # px per world unit for radii
    ol = PALETTE["outline"]
    edge = 1.3 * SS

    items = []
    for p in pose.parts:
        a, b = _to_world(p.a, h), _to_world(p.b, h)
        items.append(((_depth(a) + _depth(b)) / 2 + (0.0005 if p.kind == "ball" else 0), p, a, b))
    hw = _to_world(pose.head, h)
    items.append((_depth(hw) - 0.0001, None, hw, hw))
    items.sort(key=lambda t: t[0])

    def cap(a2, b2, r, col):
        for rad, c in ((r + edge, ol), (r, col)):
            d.line([a2, b2], fill=c, width=int(round(rad * 2)))
            for q in (a2, b2):
                d.ellipse([q[0] - rad, q[1] - rad, q[0] + rad, q[1] + rad], fill=c)

    for _, part, a, b in items:
        if part is None:
            _draw_head(d, hw, h, unit, ol, edge)
            continue
        cap(_to_px(a, SS), _to_px(b, SS), part.r * unit, part.color)

    if pose.glow:
        glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        gd = ImageDraw.Draw(glow)
        for c, r, alpha in pose.glow:
            cx, cy = _to_px(_to_world(c, h), SS)
            for k in range(4, 0, -1):
                rr = r * unit * k / 3
                gd.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=(*PALETTE["glow"], int(255 * alpha * (1 - k / 5) * 0.8)))
        img = Image.alpha_composite(img, glow)
    return img.resize((FRAME_W, FRAME_H), Image.LANCZOS)


def _draw_head(d: ImageDraw.ImageDraw, hw, h, unit, ol, edge) -> None:
    cx, cy = _to_px(hw, SS)
    R = HEAD_R * unit
    # facing towards the camera? (forward vector dotted with the view axis)
    fwd_dot = h[0] + h[1]                          # >0 faces camera
    sf = project(h[0], h[1], 0, TILE_W, TILE_H, Z_SCALE)
    sl = math.hypot(*sf) or 1.0
    fx, fy = sf[0] / sl, sf[1] / sl                # screen-space forward unit vector
    c = PALETTE
    # base skull
    d.ellipse([cx - R - edge, cy - R - edge, cx + R + edge, cy + R + edge], fill=ol)
    d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=c["hair"])
    if fwd_dot > -0.5 * math.sqrt(2) * 0.99:       # face visible (not facing directly away)
        shift = 0.30 * R * min(1.0, 0.45 + max(0.0, fwd_dot) * 0.5)
        fcx, fcy = cx + fx * shift, cy + fy * shift + 0.14 * R
        fr = R * 0.86
        d.ellipse([fcx - fr, fcy - fr, fcx + fr, fcy + fr], fill=c["skin"])
        # fringe
        d.pieslice([cx - R, cy - R, cx + R, cy + R], 195, 345, fill=c["hair"])
        if fwd_dot > -0.1:  # eyes visible (one eye in profile)
            ex = (-h[1], h[0])  # lateral vector (world)
            for s in (-1, 1):
                lat_world = (ex[0] * s * 0.085, ex[1] * s * 0.085, 0.0)
                lp = project(lat_world[0] + h[0] * HEAD_R * 0.7, lat_world[1] + h[1] * HEAD_R * 0.7, 0, TILE_W, TILE_H, Z_SCALE)
                ex_px, ey_px = fcx + lp[0] * SS * 0.95, fcy + lp[1] * SS * 0.95 - 0.02 * R
                rr = 0.075 * R * 1.6
                d.ellipse([ex_px - rr, ey_px - rr * 1.3, ex_px + rr, ey_px + rr * 1.3], fill=c["eye"])
    else:
        d.ellipse([cx - R * 0.98, cy - R * 0.98, cx + R * 0.98, cy + R * 0.98], fill=c["hair"])


# ---------------------------------------------------------------------------
# Character assembly
# ---------------------------------------------------------------------------

def cycle_travel(stride: float, direction: str) -> dict:
    """Screen displacement (px) of the body over one loop, from the shared projection."""
    h = heading(direction)
    sx, sy = project(h[0] * stride, h[1] * stride, 0, TILE_W, TILE_H, Z_SCALE)
    return {"x": round(sx, 4), "y": round(sy, 4)}


def render_animation(spec: AnimSpec, direction: str) -> tuple[list[Image.Image], list[list[dict]]]:
    frames, feet = [], []
    for i in range(spec.frames):
        pose = build_pose(spec.fn(i, spec.frames))
        frames.append(render_pose(pose, direction))
        feet.append(foot_px(pose, direction))
    return frames, feet


def available_animations(only: list[str] | None = None) -> list[AnimSpec]:
    return [a for a in ANIMATIONS if not only or a.key in only]


DIRS = DIRECTIONS_8
