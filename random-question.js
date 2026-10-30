(function () {
  const EFFECTS_KEY = "standup-jeopardy-sound-effects-enabled";

  function addPattern(control) {
    const pattern = document.createElement("span");
    pattern.className = "random-pattern";
    pattern.setAttribute("aria-hidden", "true");
    const wordCount = control.classList.contains("category") ? 32 : 8;
    for (let index = 0; index < wordCount; index += 1) {
      const word = document.createElement("span");
      word.textContent = "RANDOM";
      pattern.append(word);
    }
    control.append(pattern);
  }

  function setup(options) {
    const { boardElement, globalButton, effectsSetting, getClues, openClue, isBlocked } = options;
    const announcement = document.getElementById("randomStatus");
    let busy = false;
    let audioContext;
    let highlightedTile;
    effectsSetting.checked = localStorage.getItem(EFFECTS_KEY) !== "false";
    effectsSetting.addEventListener("change", () => {
      localStorage.setItem(EFFECTS_KEY, String(effectsSetting.checked));
      if (!effectsSetting.checked) {
        document.getElementById("dailyDoubleSound").pause();
        if (audioContext) audioContext.suspend().catch(() => {});
      }
    });
    addPattern(globalButton);

    async function prepareAudio() {
      if (!effectsSetting.checked) return;
      try {
        audioContext ||= new window.AudioContext();
        await audioContext.resume();
      } catch {
        // Audio support must never prevent selection.
      }
    }

    function tone(landing) {
      if (!effectsSetting.checked || !audioContext || audioContext.state !== "running") return;
      try {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const now = audioContext.currentTime;
        const duration = landing ? 0.28 : 0.085;
        oscillator.type = "sine";
        oscillator.frequency.value = landing ? 880 : 440;
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.09, now + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start(now);
        oscillator.stop(now + duration);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      } catch {
        // Continue silently when the browser cannot play an effect.
      }
    }

    function eligible(categoryId) {
      return getClues().filter(clue => clue.status === "available" && !clue.outcome &&
        (categoryId === undefined || clue.categoryId === categoryId));
    }

    function refresh() {
      globalButton.disabled = busy || isBlocked() || eligible().length === 0;
      boardElement.querySelectorAll(".category").forEach(header => {
        header.disabled = busy || isBlocked() || eligible(header.dataset.categoryId).length === 0;
      });
    }

    function highlight(clue, landing) {
      highlightedTile?.classList.remove("random-highlight", "random-winner");
      highlightedTile = Array.from(boardElement.querySelectorAll(".tile"))
        .find(tile => tile.dataset.clueId === clue.id);
      highlightedTile?.classList.add("random-highlight");
      if (landing) highlightedTile?.classList.add("random-winner");
      tone(landing);
    }

    async function select(categoryId) {
      if (busy || isBlocked()) return;
      const candidates = eligible(categoryId).sort((a, b) => a.rowIndex - b.rowIndex);
      if (!candidates.length) return;
      const winnerIndex = Math.floor(Math.random() * candidates.length);
      const winner = candidates[winnerIndex];
      busy = true;
      const audioReady = prepareAudio();
      announcement.textContent = "Choosing a random question…";
      boardElement.setAttribute("aria-busy", "true");
      const controls = Array.from(document.querySelectorAll(".header button, .header input, #board button"));
      const disabledBefore = controls.map(control => control.disabled);
      controls.forEach(control => { control.disabled = true; });
      document.querySelector(".header").inert = true;
      const wait = milliseconds => new Promise(resolve => window.setTimeout(resolve, milliseconds));
      let sourceTile;
      try {
        // Browsers resume audio asynchronously. Bound the wait so blocked audio
        // cannot hold up the game, including landing-only selections.
        await Promise.race([audioReady, wait(100)]);
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (candidates.length > 1 && !reduceMotion) {
          let steps = 20;
          if (categoryId !== undefined) {
            steps += (winnerIndex - (steps - 1) % candidates.length + candidates.length) % candidates.length;
          }
          const weights = Array.from({ length: steps - 1 }, (_, i) => 60 + 250 * (i / (steps - 2)) ** 2);
          const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
          let previousIndex = -1;
          for (let step = 0; step < steps; step += 1) {
            const landing = step === steps - 1;
            let index = step % candidates.length;
            if (categoryId === undefined && !landing) {
              // Pick from the other tiles so every boop has a visible change.
              index = Math.floor(Math.random() * (candidates.length - (previousIndex < 0 ? 0 : 1)));
              if (previousIndex >= 0 && index >= previousIndex) index += 1;
            }
            if (landing) index = winnerIndex;
            highlight(candidates[index], landing);
            previousIndex = index;
            if (!landing) await wait(2600 * weights[step] / totalWeight);
          }
          await wait(400);
        } else {
          highlight(winner, true);
          // A short landing cue also keeps Daily Double audio from overlapping.
          await wait(300);
        }
        sourceTile = highlightedTile;
        announcement.textContent = "Selected " + sourceTile.textContent + " in " +
          Array.from(boardElement.querySelectorAll(".category"))
            .find(header => header.dataset.categoryId === winner.categoryId).querySelector(".category-title").textContent;
      } finally {
        highlightedTile?.classList.remove("random-highlight", "random-winner");
        highlightedTile = null;
        busy = false;
        boardElement.removeAttribute("aria-busy");
        document.querySelector(".header").inert = false;
        controls.forEach((control, index) => { control.disabled = disabledBefore[index]; });
        refresh();
      }
      openClue(winner.id, sourceTile);
    }

    globalButton.addEventListener("click", () => select());
    const dialogObserver = new MutationObserver(refresh);
    document.querySelectorAll('[role="dialog"]').forEach(dialog => {
      dialogObserver.observe(dialog, { attributes: true, attributeFilter: ["hidden"] });
    });
    return {
      get busy() { return busy; },
      refresh,
      decorateCategory(header, category) {
        header.dataset.categoryId = category.id;
        header.setAttribute("aria-label", "Random question in " + category.title);
        const title = document.createElement("span");
        title.className = "category-title";
        title.textContent = category.title;
        header.replaceChildren(title);
        addPattern(header);
        header.addEventListener("click", () => select(category.id));
      }
    };
  }

  window.jeopardyRandom = { setup };
})();
