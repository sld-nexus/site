/* 재료 체크: V43의 보유량 입력 UI를 V47 공통 계산·수동 완료 정책에 맞춰 이식 */
window.NEXUS_MATERIAL = function createMaterialBoard(ctx) {
    'use strict';

    const CORE_ATOMS = Object.freeze([...ctx.SYSTEM_CONFIG.costboardAtoms, ctx.VOID_RAY_ATOM]);
    const ALL_ATOMS = Object.freeze([...CORE_ATOMS, ...ctx.LEGACY_COMPLETION_ATOMS]);
    const ATOM_NAME_BY_ID = new Map(ALL_ATOMS.map(atom => [ctx.clean(atom), atom]));
    const INPUT_STEPS = new Map([[ctx.clean('자동포탑'), 5]]);
    const ALL_IDS = new Set(ALL_ATOMS.map(ctx.clean));
    const CORE_IDS = new Set(CORE_ATOMS.map(ctx.clean));
    const BOTTOM_IDS = new Set(['땅거미지뢰', '자동포탑', '우르사돈암', '우르사돈수', ctx.VOID_RAY_ATOM].map(ctx.clean));
    const voidRecipeCache = new Map();
    let expanded = false;
    let manual = false;
    let rendered = false;

    // 계산 결과는 공통 calculateCostboardAtomTotals와 해당 캐시 엔진을 재사용한다.
    function countVoidRayInRecipe(uid) {
        if (voidRecipeCache.has(uid)) return voidRecipeCache.get(uid);
        const walk = (id, qty, ancestors, parentId = '') => {
            if (!id || ancestors.has(id)) return 0;
            const isTool = parentId && ctx.isToolRequirement(parentId, id);
            let result = id === ctx.VOID_RAY_ID && !isTool ? qty : 0;
            const unit = ctx.unitMap.get(id);
            if (!unit?.parsedRecipe?.length || ctx.isConditionOnlyRecipe(unit)) return result;
            ancestors.add(id);
            for (const child of unit.parsedRecipe) {
                result += walk(child.id, ctx.isToolRequirement(id, child.id) ? 1 : qty * child.qty, ancestors, id);
            }
            ancestors.delete(id);
            return result;
        };
        const amount = walk(uid, 1, new Set());
        voidRecipeCache.set(uid, amount);
        return amount;
    }

    function getTrackedTargets() {
        const tracked = new Map(ctx.activeUnits);
        ctx.completedTargets.forEach((qty, uid) => {
            if (qty > 0) tracked.set(uid, (tracked.get(uid) || 0) + qty);
        });
        return tracked;
    }

    function getSlotDefs(isExpanded = expanded) {
        if (!isExpanded) return ctx.COSTBOARD_DISPLAY_SLOT_DEFS;
        const main = [], bottom = [];
        for (const slot of ctx.COSTBOARD_DISPLAY_SLOT_DEFS) {
            (slot.atoms.some(atom => BOTTOM_IDS.has(ctx.clean(atom))) ? bottom : main).push(slot);
        }
        return [...main, ...ctx.LEGACY_COMPLETION_ATOMS.map(atom => ({ atoms: [atom] })), ...bottom];
    }

    function getAtoms(isExpanded = expanded) { return isExpanded ? ALL_ATOMS : CORE_ATOMS; }

    function calculateTotals(isExpanded = expanded, activeSource = getTrackedTargets()) {
        const atoms = isExpanded ? ALL_ATOMS : ctx.SYSTEM_CONFIG.costboardAtoms;
        const totals = ctx.calculateCostboardAtomTotals(ctx.completedUnits, atoms, { activeSource, preferRecipeAtoms: isExpanded });
        if (!isExpanded) {
            let target = 0;
            activeSource.forEach((qty, uid) => { if (qty > 0) target += countVoidRayInRecipe(uid) * qty; });
            const completed = Math.min(target, Math.max(0, ctx.completedUnits.get(ctx.VOID_RAY_ID) || 0));
            totals.targetMap[ctx.VOID_RAY_ATOM] = target;
            totals.completedMap[ctx.VOID_RAY_ATOM] = completed;
            totals.remainingMap[ctx.VOID_RAY_ATOM] = target - completed;
        }
        return totals;
    }

    function gradeOf(atom) {
        return ctx.AUTO_COST_SLOT_SET.has(ctx.clean(atom)) ? '스킬사용' : (ctx.unitMap.get(ctx.clean(atom))?.grade || '');
    }
    function renderItem(atom) {
        const id = ctx.clean(atom);
        const name = ctx.escapeHtml(ctx.getCostboardDisplayName(atom));
        const grade = gradeOf(atom);
        const color = ctx.SYSTEM_CONFIG.grades.colors[grade];
        const style = color ? ` style="--material-tone:${color};"` : '';
        const step = INPUT_STEPS.get(id) || 1;
        return `<div class="material-board-item" id="material-item-${id}" data-material-id="${id}"${style}>
            <div class="material-board-main">
                ${grade ? `<span class="material-board-grade gtag grade-${ctx.escapeHtml(grade)}">${ctx.escapeHtml(grade)}</span>` : ''}
                <span class="material-board-name">${name}</span>
                <button type="button" class="material-board-tap" data-action="materialAdd" data-material-id="${id}" data-delta="${step}" aria-label="${name} 보유량 추가"><span id="material-owned-${id}" class="material-board-count">-</span></button>
                <input type="number" class="material-board-input" id="material-input-${id}" data-material-id="${id}" min="0" step="1" inputmode="numeric" aria-label="${name} 보유 수량">
                <span class="material-board-caption">보유량</span>
            </div>
            <div class="material-board-controls">
                <button type="button" data-action="materialAdd" data-material-id="${id}" data-delta="${step}" class="pc-btn material-board-plus">+${step}</button>
                <button type="button" data-action="materialAdd" data-material-id="${id}" data-delta="10" class="pc-btn material-board-plus material-board-plus10">+10</button>
            </div>
        </div>`;
    }
    function renderSlot({ atoms }) {
        const grade = gradeOf(atoms[0]);
        const tone = ctx.SYSTEM_CONFIG.grades.colors[grade] || '#efd3a4';
        const slotType = atoms.some(atom => ctx.AUTO_COST_SLOT_SET.has(ctx.clean(atom))) ? 'is-skill-slot' : 'is-magic-slot';
        return `<div class="material-board-slot ${slotType}${atoms.length > 1 ? ' is-split-slot' : ''}" style="--card-tone:${tone};" data-slot-atoms="${atoms.map(ctx.clean).join(',')}">
            ${atoms.map(renderItem).join(atoms.length > 1 ? '<span class="material-board-split-divider" aria-hidden="true"></span>' : '')}
        </div>`;
    }
    function updateModeButtons() {
        const inputBtn = ctx.getEl('materialBoardInputModeBtn');
        if (inputBtn) {
            inputBtn.querySelector('.material-board-action-label').textContent = manual ? '자동입력 전환' : '수동입력 전환';
            inputBtn.classList.toggle('is-manual', manual);
            inputBtn.setAttribute('aria-pressed', String(manual));
        }
        const modeBtn = ctx.getEl('materialBoardSlotModeBtn');
        if (modeBtn) {
            modeBtn.querySelector('.material-board-action-label').textContent = expanded ? '핵심재료 전환' : '전체재료 전환';
            modeBtn.classList.toggle('is-expanded', expanded);
            modeBtn.setAttribute('aria-pressed', String(expanded));
        }
    }
    function render() {
        if (rendered) return;
        const board = ctx.getEl('boardContent');
        if (!board) return;
        ctx.returnHiddenboardControlsToHeader();
        ctx._isHiddenboardRendered = false;
        board.classList.remove('highlight-mode');
        board.classList.add('material-board-mode');
        board.innerHTML = `<section class="material-board-workspace" aria-label="재료 체크">
            <header class="material-board-heading"><h2>재료 체크</h2>
                <div class="material-board-actions">
                    <button type="button" class="pc-btn material-board-complete-all" id="materialBoardCompleteAllBtn" data-action="materialCompleteAll"><span class="material-board-action-label">전체 완료</span><span class="material-board-action-icon" aria-hidden="true">✓</span></button>
                    <button type="button" class="pc-btn material-board-reset" data-action="materialReset"><span class="material-board-action-label">보유량 초기화</span><span class="material-board-action-icon" aria-hidden="true">↺</span></button>
                    <button type="button" class="pc-btn material-board-mode-input" id="materialBoardInputModeBtn" data-action="materialToggleInput" aria-pressed="false"><span class="material-board-action-label">수동입력 전환</span></button>
                    <button type="button" class="pc-btn material-board-slot-toggle" id="materialBoardSlotModeBtn" data-action="materialToggleSlots" aria-pressed="false"><span class="material-board-action-label">전체재료 전환</span><span class="material-board-action-icon" aria-hidden="true">▦</span></button>
                </div>
            </header>
            <div class="material-board-body"><div id="materialBoardEmpty" class="empty-msg"></div>
                <div id="materialBoardGrid" class="material-board-grid">${getSlotDefs().map(renderSlot).join('')}</div>
            </div></section>`;
        rendered = true;
        updateModeButtons();
    }
    function refresh() {
        if (!rendered) return;
        const totals = calculateTotals();
        for (const atom of getAtoms()) {
            const id = ctx.clean(atom), item = ctx.getEl(`material-item-${id}`);
            if (!item) continue;
            const need = Math.max(0, Number(totals.targetMap[atom]) || 0);
            const owned = Math.min(need, Math.max(0, Number(totals.completedMap[atom]) || 0));
            const stored = Math.max(0, Number(ctx.completedUnits.get(id)) || 0);
            const manualQty = Math.max(0, Number(ctx._materialManualInputs.get(id)) || 0);
            const shownQty = Math.max(stored, manualQty);
            const remain = Math.max(0, need - owned);
            const disabled = need <= 0 && owned <= 0;
            const isOver = manual && need > 0 && shownQty > need;
            item.classList.toggle('is-disabled', disabled);
            item.classList.toggle('has-active', !disabled);
            item.classList.toggle('is-manual', manual);
            const amount = ctx.getEl(`material-owned-${id}`);
            if (amount) {
                const value = disabled ? '-' : String(owned);
                if (amount.textContent !== value) amount.textContent = value;
            }
            const input = ctx.getEl(`material-input-${id}`);
            if (input) {
                if (document.activeElement !== input || disabled) {
                    const value = disabled ? '' : String(manual ? shownQty : owned);
                    if (input.value !== value) input.value = value;
                }
                input.disabled = disabled || !manual;
                input.max = String(need);
                input.placeholder = disabled ? '-' : '';
                input.classList.toggle('is-over-limit', isOver);
                input.setAttribute('aria-invalid', String(isOver));
            }
            const tap = item.querySelector('.material-board-tap');
            if (tap) tap.disabled = manual || remain <= 0;
            item.querySelectorAll('.material-board-plus').forEach(btn => {
                btn.disabled = remain < (Number(btn.dataset.delta) || 1);
            });
        }
        ctx.getEl('materialBoardGrid')?.querySelectorAll('.material-board-slot').forEach(slot => {
            slot.classList.toggle('has-active', !!slot.querySelector('.material-board-item.has-active'));
        });
        const completeBtn = ctx.getEl('materialBoardCompleteAllBtn');
        if (completeBtn) completeBtn.disabled = ctx.activeUnits.size === 0;
        const empty = ctx.getEl('materialBoardEmpty');
        if (empty) {
            empty.hidden = ctx.activeUnits.size > 0 || ctx.completedTargets.size > 0;
            empty.textContent = empty.hidden ? '' : '유닛 도감에서 유닛을 선택하세요';
        }
        updateModeButtons();
    }
    function invalidate() { rendered = false; }
    function setAmount(id, qty) {
        const atomId = ctx.normalizeSavedId(id);
        if (!ALL_IDS.has(atomId) || (!expanded && !CORE_IDS.has(atomId))) return;
        const atomName = ATOM_NAME_BY_ID.get(atomId);
        const maximum = Math.max(0, Number(calculateTotals().targetMap[atomName]) || 0);
        const raw = Math.max(0, parseInt(qty, 10) || 0);
        const next = Math.min(raw, maximum);
        if (next > 0) ctx.completedUnits.set(atomId, next);
        else ctx.completedUnits.delete(atomId);
        if (manual && raw > next && maximum > 0) ctx._materialManualInputs.set(atomId, raw);
        else ctx._materialManualInputs.delete(atomId);
        // 보유량 입력은 조합 자동 완료를 발생시키지 않는다.
        ctx.commitNexusStateChange();
    }
    function addAmount(id, delta) {
        const atomId = ctx.normalizeSavedId(id);
        setAmount(atomId, (ctx.completedUnits.get(atomId) || 0) + (parseInt(delta, 10) || 0));
    }
    function resetAmounts() {
        let changed = false;
        ALL_IDS.forEach(id => { if (ctx.completedUnits.delete(id)) changed = true; });
        if (ctx._materialManualInputs.size) { ctx._materialManualInputs.clear(); changed = true; }
        // 보유량 초기화는 기존 조합 완료 내역까지 되돌리지 않는다.
        if (changed) ctx.commitNexusStateChange();
    }
    function completeAll() {
        if (!ctx.activeUnits.size) return;
        const totals = calculateTotals();
        ALL_IDS.forEach(id => ctx.completedUnits.delete(id));
        ctx._materialManualInputs.clear();
        for (const atom of getAtoms()) {
            const qty = Math.max(0, parseInt(totals.targetMap[atom], 10) || 0);
            if (qty) ctx.completedUnits.set(ctx.clean(atom), qty);
        }
        for (const [uid, qty] of [...ctx.activeUnits]) {
            ctx.completedTargets.set(uid, ctx.normalizeUnitQty(uid, qty) || 1);
            ctx.activeUnits.delete(uid);
            ctx.pausedUnits.delete(uid);
        }
        ctx.commitNexusStateChange({ clearHighlight: true });
    }
    function toggleInput() { manual = !manual; refresh(); }
    function toggleSlots() {
        expanded = !expanded;
        invalidate();
        if (ctx._currentViewMode === 'invenboard') {
            render();
            refresh();
        }
    }

    return { render, refresh, invalidate, setAmount, addAmount, resetAmounts, completeAll,
        toggleInput, toggleSlots, calculateTotals, getSlotDefs, getAtoms };
};
