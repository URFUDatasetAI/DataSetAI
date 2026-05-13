# Video Annotation Workflow

## Status

Active implementation track. First version is rules-based and uses frame tasks grouped by source video.

## Product Model

- Video upload creates `VideoAsset` rows and then extracted image-frame `Task` rows with one `VideoFrame` per task.
- The service does not use ML/detectors in v1. Automation is FFmpeg extraction plus rules-based interpolation between accepted keyframes.
- `VideoFrame.role` separates `manual_keyframe` from `interpolation_target`.
- `VideoFrame.state` controls assignment/review/export: only `pending_manual` and `generated_rejected` frames are assignable to annotators.
- Bbox annotations on video frames require `track_id` on every box.
- `skip` means "I cannot/will not do this task"; `frame_state=no_object` means a valid final labeling decision.

## Workflow

1. Room creation stores each uploaded source video as `VideoAsset`.
2. Django RQ job `extract_video_frames(video_asset_id)` uses FFmpeg and creates frame image tasks.
3. Only manual keyframes are available before interpolation.
4. Accepted manual keyframes with matching `track_id` enqueue interpolation.
5. Interpolation creates generated proposals for target frames and puts them into review, not export.
6. Reviewer can approve generated bbox, reject it to manual correction, or mark the frame no-object.
7. Detector exports include only final manual or approved generated frames with annotations. No-object frames are excluded from COCO/YOLO/Pascal.
8. Native JSON/JSONL preserve video/frame provenance, track ids, source (`manual`/`generated`/`no_object`) and trajectory warnings.

## Infrastructure

- Dependencies: `django-rq`, `rq`, `redis`.
- Settings: `REDIS_URL`, `RQ_ASYNC`.
- Local/test default can run jobs synchronously with `RQ_ASYNC=False`.
- Production must run Redis, FFmpeg, Django web service and `python manage.py rqworker default`.

## Files

- `apps/labeling/models.py` - `VideoAsset`, `VideoFrame`.
- `apps/labeling/jobs.py` - extraction and interpolation jobs.
- `apps/labeling/services.py` - assignment/submit/review state transitions.
- `apps/labeling/api/v1/serializers.py` - track-id/no-object validation and frame context.
- `apps/rooms/services.py` - video asset creation and export filtering.
- `apps/ui/static/ui/app.tsx` - create-room video settings, frame strip, track controls, no-object action.

## Risks

- Assignment changes must preserve quota and skip exposure semantics.
- Review filters must not hide generated proposals or incomplete cross-validation tasks.
- Generated proposals must never become detector-exportable before human approval.
- Production deploy must restart the RQ worker after migrations/code updates.
