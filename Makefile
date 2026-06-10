# Benchmark-runner image builds — run from the repository root.
#
# Base images  (ghcr.io/weetime/, rebuilt only on tool version bumps):
#   make base                 build + push all; skips tags already in registry
#   make base-vegeta          single tool
#   make base-evalscope
#   make base-aiperf
#   make base FORCE=1         force-rebuild even if tag already in registry
#   make base-vegeta FORCE=1
#
# Runner images  (local Docker + k3d import, rebuilt when runner/ changes):
#   make runner               build + import all four; skips if local tag exists
#   make runner-guidellm      single tool
#   make runner-vegeta
#   make runner-evalscope
#   make runner-aiperf
#   make runner IMPORT=0      build only, skip k3d import

K3D_CLUSTER ?= modeldoctor
FORCE       ?= 0
IMPORT      ?= 1

BASE_TOOLS   := vegeta evalscope aiperf
RUNNER_TOOLS := guidellm vegeta evalscope aiperf

_BASE_FLAGS  := $(if $(filter 1,$(FORCE)),--force,)
_IMPORT_FLAG := $(if $(filter 0,$(IMPORT)),--no-import,)

.PHONY: base runner \
        $(addprefix base-,$(BASE_TOOLS)) \
        $(addprefix runner-,$(RUNNER_TOOLS))

# ── Base images ───────────────────────────────────────────────────────────────

base:
	bash tools/build-base-images.sh $(_BASE_FLAGS)

$(addprefix base-,$(BASE_TOOLS)): base-%:
	bash tools/build-base-images.sh $(_BASE_FLAGS) $*

# ── Runner images ─────────────────────────────────────────────────────────────

runner:
	K3D_CLUSTER=$(K3D_CLUSTER) bash tools/build-runner-images.sh $(_IMPORT_FLAG)

$(addprefix runner-,$(RUNNER_TOOLS)): runner-%:
	K3D_CLUSTER=$(K3D_CLUSTER) bash tools/build-runner-images.sh $(_IMPORT_FLAG) $*
