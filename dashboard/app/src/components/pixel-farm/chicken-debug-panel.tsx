import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  PIXEL_FARM_CHICKEN_COLORS,
  PIXEL_FARM_CHICKEN_STATE_OPTIONS,
  type PixelFarmChickenColor,
  type PixelFarmChickenState,
} from "@/lib/pixel-farm/chicken";
import {
  createDefaultPixelFarmChickenDebugState,
  type PixelFarmChickenDebugState,
} from "@/lib/pixel-farm/create-game";

interface ChickenDebugPanelProps {
  value: PixelFarmChickenDebugState;
  onChange: (next: PixelFarmChickenDebugState) => void;
}

function updateState(
  value: PixelFarmChickenDebugState,
  patch: Partial<PixelFarmChickenDebugState>,
): PixelFarmChickenDebugState {
  return {
    ...value,
    ...patch,
  };
}

export function ChickenDebugPanel({ value, onChange }: ChickenDebugPanelProps) {
  return (
    <aside className="absolute top-4 right-4 z-20 w-72 rounded-2xl border border-[#f6dca6]/25 bg-[#141109]/92 p-4 text-[#f6dca6] shadow-2xl backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.24em] text-[#f6dca6]/55">Dev Panel</div>
          <h2 className="mt-1 text-sm font-semibold tracking-[0.08em]">Chicken Preview</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="xs"
            variant="outline"
            className="border-[#f6dca6]/25 bg-transparent text-[#f6dca6] hover:bg-[#f6dca6]/10"
            onClick={() =>
              onChange(
                updateState(value, {
                  playing: true,
                  replayNonce: value.replayNonce + 1,
                }),
              )
            }
          >
            Replay
          </Button>
          <Button
            size="xs"
            variant="outline"
            className="border-[#f6dca6]/25 bg-transparent text-[#f6dca6] hover:bg-[#f6dca6]/10"
            onClick={() => onChange(createDefaultPixelFarmChickenDebugState())}
          >
            Reset
          </Button>
        </div>
      </div>

      <div className="mt-4 space-y-3 text-xs">
        <PanelSwitch
          checked={value.visible}
          label="Visible"
          onCheckedChange={(visible) => onChange(updateState(value, { visible }))}
        />
        <PanelSwitch
          checked={value.playing}
          label="Animate"
          onCheckedChange={(playing) => onChange(updateState(value, { playing }))}
        />
        <PanelSwitch
          checked={value.flipX}
          label="FlipX"
          onCheckedChange={(flipX) => onChange(updateState(value, { flipX }))}
        />
        <PanelSelect
          label="Color"
          onValueChange={(color) =>
            onChange(updateState(value, { color: color as PixelFarmChickenColor }))
          }
          options={PIXEL_FARM_CHICKEN_COLORS}
          value={value.color}
        />
        <PanelSelect
          label="State"
          onValueChange={(state) =>
            onChange(updateState(value, { state: state as PixelFarmChickenState }))
          }
          options={PIXEL_FARM_CHICKEN_STATE_OPTIONS}
          value={value.state}
        />
      </div>
    </aside>
  );
}

interface PanelSelectProps {
  label: string;
  onValueChange: (value: string) => void;
  options: readonly string[];
  value: string;
}

function PanelSelect({ label, onValueChange, options, value }: PanelSelectProps) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-[11px] uppercase tracking-[0.18em] text-[#f6dca6]/55">{label}</span>
      <Select onValueChange={onValueChange} value={value}>
        <SelectTrigger className="w-full border-[#f6dca6]/20 bg-[#221a0d] text-[#f6dca6]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="border-[#f6dca6]/20 bg-[#221a0d] text-[#f6dca6]">
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

interface PanelSwitchProps {
  checked: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}

function PanelSwitch({ checked, label, onCheckedChange }: PanelSwitchProps) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-xl border border-[#f6dca6]/12 bg-[#221a0d]/70 px-3 py-2">
      <span className="text-[11px] uppercase tracking-[0.18em] text-[#f6dca6]/72">{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  );
}
