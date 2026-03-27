import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  PIXEL_FARM_BABY_COW_COLORS,
  PIXEL_FARM_BABY_COW_STATE_OPTIONS,
} from "@/lib/pixel-farm/baby-cow";
import {
  PIXEL_FARM_CHICKEN_COLORS,
  PIXEL_FARM_CHICKEN_STATE_OPTIONS,
} from "@/lib/pixel-farm/chicken";
import {
  PIXEL_FARM_CHARACTER_ACTION_OPTIONS,
  PIXEL_FARM_CHARACTER_DIRECTIONS,
} from "@/lib/pixel-farm/character";
import {
  createDefaultPixelFarmDebugState,
  PIXEL_FARM_DEBUG_ACTOR_TYPES,
  type PixelFarmDebugActorState,
  type PixelFarmDebugActorType,
  type PixelFarmDebugActorVariant,
  type PixelFarmDebugState,
} from "@/lib/pixel-farm/create-game";
import {
  PIXEL_FARM_COW_COLORS,
  PIXEL_FARM_COW_STATE_OPTIONS,
} from "@/lib/pixel-farm/cow";

interface PixelFarmActorPreviewPanelProps {
  showInteractionDebug: boolean;
  showSpatialDebug: boolean;
  onToggleInteractionDebug: () => void;
  onToggleSpatialDebug: () => void;
  value: PixelFarmDebugState;
  onChange: (next: PixelFarmDebugState) => void;
}

const DIRECTION_OPTIONS = ["left", "right"] as const;

function humanizeLabel(value: string): string {
  return value
    .replace(/-/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (char) => char.toUpperCase());
}

function radioOptions(values: readonly string[]): Array<{ label: string; value: string }> {
  return values.map((value) => ({
    label: humanizeLabel(value),
    value,
  }));
}

function defaultStateForType(
  type: PixelFarmDebugActorType,
  current: PixelFarmDebugState,
): PixelFarmDebugState {
  const next = createDefaultPixelFarmDebugState(type);

  return {
    ...next,
    playing: current.playing,
    replayNonce: current.replayNonce,
    visible: current.visible,
  };
}

function variantOptionsForType(type: PixelFarmDebugActorType): readonly string[] {
  switch (type) {
    case "character":
      return ["default"];
    case "cow":
      return PIXEL_FARM_COW_COLORS;
    case "baby-cow":
      return PIXEL_FARM_BABY_COW_COLORS;
    case "chicken":
      return PIXEL_FARM_CHICKEN_COLORS;
  }
}

function stateOptionsForType(type: PixelFarmDebugActorType): readonly string[] {
  switch (type) {
    case "character":
      return PIXEL_FARM_CHARACTER_ACTION_OPTIONS;
    case "cow":
      return PIXEL_FARM_COW_STATE_OPTIONS;
    case "baby-cow":
      return PIXEL_FARM_BABY_COW_STATE_OPTIONS;
    case "chicken":
      return PIXEL_FARM_CHICKEN_STATE_OPTIONS;
  }
}

function directionOptionsForType(type: PixelFarmDebugActorType): readonly string[] {
  return type === "character" ? PIXEL_FARM_CHARACTER_DIRECTIONS : DIRECTION_OPTIONS;
}

export function PixelFarmActorPreviewPanel({
  showInteractionDebug,
  showSpatialDebug,
  onToggleInteractionDebug,
  onToggleSpatialDebug,
  value,
  onChange,
}: PixelFarmActorPreviewPanelProps) {
  const [collapsed, setCollapsed] = useState(true);
  const variantOptions = variantOptionsForType(value.type);
  const stateOptions = stateOptionsForType(value.type);
  const directionOptions = directionOptionsForType(value.type);

  if (collapsed) {
    return (
      <aside>
        <Button
          size="sm"
          variant="outline"
          className="rounded-full border-[#f6dca6]/25 bg-[#141109]/92 px-4 text-[#f6dca6] shadow-xl backdrop-blur hover:bg-[#221a0d]"
          onClick={() => setCollapsed(false)}
        >
          Open Actor Preview
        </Button>
      </aside>
    );
  }

  return (
    <aside className="pixel-farm-font w-[28rem] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl border border-[#f6dca6]/25 bg-[#141109]/92 p-4 text-[#f6dca6] shadow-2xl backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.24em] text-[#f6dca6]/55">
            Actor Preview
          </div>
          <h2 className="mt-1 text-sm font-semibold tracking-[0.08em]">
            Preview Controls
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="xs"
            variant="outline"
            className="border-[#f6dca6]/25 bg-transparent text-[#f6dca6] hover:bg-[#f6dca6]/10"
            onClick={() => setCollapsed(true)}
          >
            Collapse
          </Button>
          <Button
            size="xs"
            variant="outline"
            className="border-[#f6dca6]/25 bg-transparent text-[#f6dca6] hover:bg-[#f6dca6]/10"
            onClick={() =>
              onChange({
                ...value,
                playing: true,
                replayNonce: value.replayNonce + 1,
              })
            }
          >
            Replay
          </Button>
          <Button
            size="xs"
            variant="outline"
            className="border-[#f6dca6]/25 bg-transparent text-[#f6dca6] hover:bg-[#f6dca6]/10"
            onClick={onToggleSpatialDebug}
          >
            {showSpatialDebug ? "Hide Bodies" : "Show Bodies"}
          </Button>
          <Button
            size="xs"
            variant="outline"
            className="border-[#f6dca6]/25 bg-transparent text-[#f6dca6] hover:bg-[#f6dca6]/10"
            onClick={onToggleInteractionDebug}
          >
            {showInteractionDebug ? "Hide Interaction" : "Show Interaction"}
          </Button>
          <Button
            size="xs"
            variant="outline"
            className="border-[#f6dca6]/25 bg-transparent text-[#f6dca6] hover:bg-[#f6dca6]/10"
            onClick={() => onChange(createDefaultPixelFarmDebugState(value.type))}
          >
            Reset
          </Button>
        </div>
      </div>

      <div className="mt-4 space-y-4">
        <RadioChipGroup
          label="Object"
          name="actor-preview-object"
          onChange={(nextType) =>
            onChange(defaultStateForType(nextType as PixelFarmDebugActorType, value))
          }
          options={radioOptions(PIXEL_FARM_DEBUG_ACTOR_TYPES)}
          value={value.type}
        />
        {variantOptions.length > 1 ? (
          <RadioChipGroup
            label="Variant"
            name="actor-preview-variant"
            onChange={(variant) =>
              onChange({
                ...value,
                replayNonce: value.replayNonce + 1,
                variant: variant as PixelFarmDebugActorVariant,
              })
            }
            options={radioOptions(variantOptions)}
            value={value.variant}
          />
        ) : null}
        <RadioChipGroup
          label={value.type === "character" ? "Direction" : "Facing"}
          name="actor-preview-direction"
          onChange={(direction) =>
            onChange({ ...value, direction: direction as typeof value.direction })
          }
          options={radioOptions(directionOptions)}
          value={value.direction}
        />
        <RadioChipGroup
          label="State"
          name="actor-preview-state"
          onChange={(state) =>
            onChange({
              ...value,
              replayNonce: value.replayNonce + 1,
              state: state as PixelFarmDebugActorState,
            })
          }
          options={radioOptions(stateOptions)}
          value={value.state}
        />
        <RadioChipGroup
          label="Animation"
          name="actor-preview-animation"
          onChange={(mode) => onChange({ ...value, playing: mode === "play" })}
          options={[
            { label: "Play", value: "play" },
            { label: "Pause", value: "pause" },
          ]}
          value={value.playing ? "play" : "pause"}
        />
        <RadioChipGroup
          label="Visibility"
          name="actor-preview-visibility"
          onChange={(mode) => onChange({ ...value, visible: mode === "show" })}
          options={[
            { label: "Show", value: "show" },
            { label: "Hide", value: "hide" },
          ]}
          value={value.visible ? "show" : "hide"}
        />
      </div>
    </aside>
  );
}

interface RadioChipGroupProps {
  label: string;
  name: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}

function RadioChipGroup({ label, name, onChange, options, value }: RadioChipGroupProps) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-[11px] uppercase tracking-[0.18em] text-[#f6dca6]/55">
        {label}
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const checked = option.value === value;

          return (
            <label
              key={option.value}
              className={`cursor-pointer rounded-full border px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] transition ${
                checked
                  ? "border-[#f6dca6] bg-[#f6dca6] text-[#1c1305]"
                  : "border-[#f6dca6]/18 bg-[#221a0d]/70 text-[#f6dca6]/75 hover:bg-[#2c2111]"
              }`}
            >
              <input
                checked={checked}
                className="sr-only"
                name={name}
                onChange={() => onChange(option.value)}
                type="radio"
                value={option.value}
              />
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
