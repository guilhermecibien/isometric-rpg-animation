"""Render a rigged, animated Blender model to an isometric sprite tree.

Run headless (Blender 3.6+):

  blender -b model.blend -P scripts/blender_render_sprites.py -- \
      --out out/frames --size 128 --pivot-y 90 --directions 8 \
      --action Walk=walk:8:loop --action Idle=idle:6:loop --camera-elevation 30

Output: <out>/<anim>/<DIR>/<index>.png (transparent), plus <out>/blender-render.json describing
what was rendered. Feed the tree to `isoanim atlas` (see references/blender-path.md).

NOTE: this script requires Blender and could not be executed in this repository's CI. It is a
documented integration point: the camera maths mirror isoanim.common.HEADINGS, and the output
layout is verified by `isoanim atlas`/`validate` once you run it.
"""
import argparse
import json
import math
import os
import sys

try:
    import bpy  # type: ignore
    from mathutils import Vector  # type: ignore
except ImportError:  # pragma: no cover - only meaningful inside Blender
    print("This script must be run inside Blender: blender -b model.blend -P blender_render_sprites.py -- ...", file=sys.stderr)
    sys.exit(3)

# Heading (world x, y) the model should FACE for each SCREEN direction; same table as isoanim.common.HEADINGS.
HEADINGS = {"S": (1, 1), "SW": (0, 1), "W": (-1, 1), "NW": (-1, 0), "N": (-1, -1), "NE": (0, -1), "E": (1, -1), "SE": (1, 0)}
DIRS_4 = ["S", "W", "N", "E"]


def parse(argv):
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True)
    p.add_argument("--size", type=int, default=128, help="square frame size in px")
    p.add_argument("--pivot-y", type=int, default=90, help="ground point row in the frame (the model's origin is rendered here)")
    p.add_argument("--ortho-scale", type=float, default=4.0, help="orthographic camera width in Blender units")
    p.add_argument("--camera-elevation", type=float, default=30.0, help="degrees above the ground plane (30° gives the 2:1 look)")
    p.add_argument("--directions", type=int, choices=[4, 8], default=8)
    p.add_argument("--armature", default=None, help="armature object name (default: first armature)")
    p.add_argument("--action", action="append", required=True, metavar="ACTION=name:frames[:loop]", help="Blender action → output animation")
    return p.parse_args(argv)


def setup_camera(args):
    cam_data = bpy.data.cameras.new("IsoCam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = args.ortho_scale
    cam = bpy.data.objects.new("IsoCam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    el = math.radians(args.camera_elevation)
    dist = 20.0
    # Camera looks toward the origin from the "south" screen side: world (+1,+1) in isoanim terms.
    cam.location = (dist * math.cos(el) * math.sqrt(0.5), dist * math.cos(el) * math.sqrt(0.5), dist * math.sin(el))
    direction = Vector((0, 0, 0)) - Vector(cam.location)
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    # shift the frame so that the world origin lands on pivot-y
    frac = args.pivot_y / args.size
    cam_data.shift_y = (0.5 - frac) * (1.0)  # ortho shift is expressed in frame fractions
    return cam


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    args = parse(argv)
    scene = bpy.context.scene
    scene.render.resolution_x = scene.render.resolution_y = args.size
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    setup_camera(args)

    arm = bpy.data.objects.get(args.armature) if args.armature else next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
    if arm is None:
        print("error: no armature found", file=sys.stderr)
        sys.exit(2)
    dirs = list(HEADINGS) if args.directions == 8 else DIRS_4
    report = {"frameSize": args.size, "pivot": [args.size // 2, args.pivot_y], "animations": {}}

    for spec in args.action:
        action_name, rest = spec.split("=", 1)
        parts = rest.split(":")
        anim, frames = parts[0], int(parts[1])
        loop = len(parts) > 2 and parts[2] == "loop"
        action = bpy.data.actions.get(action_name)
        if action is None:
            print(f"error: action {action_name!r} not found (have: {[a.name for a in bpy.data.actions]})", file=sys.stderr)
            sys.exit(2)
        arm.animation_data_create().action = action
        f0, f1 = action.frame_range
        for d in dirs:
            hx, hy = HEADINGS[d]
            # Blender's +Y-forward model faces world heading (hx, hy): rotate about Z.
            arm.rotation_euler[2] = math.atan2(hy, hx) - math.pi / 2
            out_dir = os.path.join(args.out, anim, d)
            os.makedirs(out_dir, exist_ok=True)
            for i in range(frames):
                t = i / frames if loop else (i / (frames - 1) if frames > 1 else 0.0)
                scene.frame_set(int(round(f0 + (f1 - f0) * t)))
                scene.render.filepath = os.path.join(out_dir, f"{i}.png")
                bpy.ops.render.render(write_still=True)
        report["animations"][anim] = {"frames": frames, "loop": loop, "directions": dirs, "action": action_name}

    with open(os.path.join(args.out, "blender-render.json"), "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)
    print("rendered", sum(a["frames"] * len(dirs) for a in report["animations"].values()), "frames to", args.out)


if __name__ == "__main__":
    main()
