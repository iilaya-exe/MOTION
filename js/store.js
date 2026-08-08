import { loadState, saveState } from "./lib/storage.js";
import { defaultState } from "./lib/defaults.js";

/**
 * The whole workspace in one object, plus the only two operations on it.
 *
 * Views read `store.state` directly and call `store.save()` after mutating it.
 * There is no change detection: a view that mutates is also the view that knows
 * what needs redrawing, so it calls its own render. That keeps the data flow
 * obvious at the cost of a little discipline.
 */
export const store = {
  state: defaultState(),

  async load() {
    try {
      store.state = await loadState();
    } catch (err) {
      console.error("Fatal: could not load any saved data.", err);
      alert("Could not load your saved data. Starting with an empty workspace.");
      store.state = defaultState();
    }
  },

  save() {
    saveState(store.state);
  },
};
