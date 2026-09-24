import { usePaseo } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";

import type { PickerOption } from "./option-picker";

/**
 * Every selectable model of every available provider, as `provider/model` —
 * the form Paseo's create call takes. Loaded once per mount; a provider that
 * cannot list its models is left out rather than failing the list.
 */
export function useModelOptions(): { options: PickerOption[]; loading: boolean } {
  const paseo = usePaseo();
  const [options, setOptions] = useState<PickerOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // An async function, not an async arrow: Hermes evaluates an async arrow
    // in an eval'd bundle to `undefined`.
    async function load(): Promise<void> {
      const available = await paseo.providers.listAvailable();
      const providers = available.providers.filter((entry) => entry.available).map((entry) => entry.provider);
      const lists = await Promise.all(
        providers.map(function (provider) {
          return paseo.providers.listModels(provider).catch(() => null);
        }),
      );
      const next: PickerOption[] = [];
      lists.forEach((result, index) => {
        const provider = providers[index];
        if (result === null || provider === undefined) return;
        (result.models ?? [])
          .filter((model) => model.isSelectable !== false)
          .forEach((model) => next.push({ label: model.label, value: `${provider}/${model.id}`, detail: provider }));
      });
      if (!cancelled) setOptions(next);
    }
    load()
      .catch((caught: unknown) => {
        console.warn("[firstmate] could not list models", caught);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [paseo]);

  return { options, loading };
}

/** The value itself as the first option when the list does not have it — typed in, or a provider that went away. */
export function withCurrent(options: readonly PickerOption[], current: string): PickerOption[] {
  if (current === "" || options.some((option) => option.value === current)) return [...options];
  return [{ label: current, value: current, detail: "not offered right now" }, ...options];
}

/**
 * The permission modes of the provider in `selection` (`provider/model`).
 * Empty while loading, for an empty selection, and for a provider with none.
 */
export function useModeOptions(selection: string): { label: string; value: string }[] {
  const paseo = usePaseo();
  const provider = selection.split("/")[0] ?? "";
  const [modes, setModes] = useState<{ label: string; value: string }[]>([]);

  useEffect(() => {
    if (provider === "") {
      setModes([]);
      return;
    }
    let cancelled = false;
    paseo.providers
      .listModes(provider)
      .then((result) => {
        if (cancelled) return;
        setModes((result.modes ?? []).map((mode) => ({ label: mode.label, value: mode.id })));
      })
      .catch((caught: unknown) => {
        console.warn(`[firstmate] could not list the modes of ${provider}`, caught);
        if (!cancelled) setModes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [paseo, provider]);

  return modes;
}
