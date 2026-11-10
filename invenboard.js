/* 기능 모듈 — V39 공통 상태·계산·저장은 app.js 단일 원본을 사용합니다. */
window.NEXUS_INVEN = function createInvenboard(ctx) {
    'use strict';
    /* 재료보드 입력·보유량·완료 처리 */

    function getInvenboardAtoms() {
        return ctx._isInvenboardSlotsExpanded ? ctx.INVENBOARD_ALL_ATOMS : ctx.INVENBOARD_CORE_ATOMS;
    }

    // 재료보드 전용 레시피 경로 집계: 유닛족보 UI와 독립적으로 계산한다.
    function countRecipeUnitInTree(uid, soughtId) {
        function walk(id, amount, parentId, ancestors) {
            if (!id) return 0;
            const isCycle = ancestors.has(id);
            const unit = ctx.unitMap.get(id);
            const isTool = !!parentId && ctx.isToolRequirement(parentId, id);
            let count = id === soughtId && !isTool ? amount : 0;
            if (isCycle || !unit?.parsedRecipe?.length || ctx.isConditionOnlyRecipe(unit)) return count;
            ancestors.add(id);
            unit.parsedRecipe.forEach(child => {
                const childAmount = ctx.isToolRequirement(id, child.id) ? 1 : amount * child.qty;
                count += walk(child.id, childAmount, id, ancestors);
            });
            ancestors.delete(id);
            return count;
        }
        return walk(uid, 1, '', new Set());
    }

    function getVoidRayTargetQty(activeSource = ctx.activeUnits) {
        let count = 0;
        activeSource.forEach((qty, uid) => {
            if (qty > 0) count += countRecipeUnitInTree(uid, ctx.VOID_RAY_ID) * qty;
        });
        return count;
    }

    function getInvenboardCalculationAtoms() {
        // 핵심 모드의 기존 매직 원가 환산은 변경하지 않고 공허 포격기를 별도 집계한다.
        return ctx._isInvenboardSlotsExpanded ? ctx.INVENBOARD_ALL_ATOMS : ctx.INVENBOARD_CORE_CALC_ATOMS;
    }

    function getInvenboardAtomTargetMap(activeSource, preferRecipeAtoms) {
        const targetMap = ctx.calculateCostboardAtomTotals(new Map(), getInvenboardCalculationAtoms(), { activeSource, preferRecipeAtoms }).targetMap;
        if (!ctx._isInvenboardSlotsExpanded) targetMap[ctx.VOID_RAY_ATOM] = getVoidRayTargetQty(activeSource);
        return targetMap;
    }

    function getInvenboardSlotDefs() {
        if (!ctx._isInvenboardSlotsExpanded) return ctx.COSTBOARD_DISPLAY_SLOT_DEFS;
        const bottomSlotIds = new Set(["땅거미지뢰", "자동포탑", "우르사돈암", "우르사돈수", ctx.VOID_RAY_ATOM].map(ctx.clean));
        const isBottomSlot = (slot) => (slot.atoms || []).some(atom => bottomSlotIds.has(ctx.clean(atom)));
        const upperSlots = ctx.COSTBOARD_DISPLAY_SLOT_DEFS.filter(slot => !isBottomSlot(slot));
        const bottomSlots = ctx.COSTBOARD_DISPLAY_SLOT_DEFS.filter(isBottomSlot);
        return [...upperSlots, ...ctx.INVENBOARD_EXPANSION_SLOT_DEFS, ...bottomSlots];
    }

    function getInvenboardSlotIdSet() {
        return ctx._isInvenboardSlotsExpanded ? ctx.ALL_INVENBOARD_SLOT_SET : ctx.INVENBOARD_SLOT_SET;
    }

    function getInvenboardInputStep(id) {
        const cleanId = ctx.normalizeSavedId(id);
        return ctx.INVENBOARD_INPUT_STEPS.get(cleanId) || 1;
    }

    function normalizeInvenboardAmount(qty, maxQty) {
        const parsed = parseInt(qty, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) return 0;
        const limit = Math.max(0, parseInt(maxQty, 10) || 0);
        if (limit <= 0) return 0;
        return Math.min(parsed, limit);
    }

    function getEffectiveInvenboardCompletedSource(completedSource = ctx.completedUnits, activeSource = ctx.getInvenboardTrackedTargets(), targetMap = null) {
        const effective = new Map(completedSource instanceof Map ? completedSource : new Map(completedSource || []));
        const targetSource = activeSource instanceof Map ? activeSource : ctx.getInvenboardTrackedTargets();
        const atomTargetMap = targetMap || getInvenboardAtomTargetMap(targetSource, ctx._isInvenboardSlotsExpanded);
        ctx.ALL_INVENBOARD_SLOT_SET.forEach(id => {
            if (!effective.has(id)) return;
            const rawQty = Math.max(0, parseInt(effective.get(id), 10) || 0);
            const maxQty = Math.max(0, parseInt(atomTargetMap[ctx.getCostboardAtomRawName(id)], 10) || 0);
            const nextQty = Math.min(rawQty, maxQty);
            if (nextQty > 0) effective.set(id, nextQty);
            else effective.delete(id);
        });
        return effective;
    }

    function calculateInvenboardCostboardTotals(completedSource = ctx.completedUnits, options = {}) {
        const activeSource = options.activeSource instanceof Map ? options.activeSource : ctx.getInvenboardTrackedTargets();
        const preferRecipeAtoms = ctx._isInvenboardSlotsExpanded;
        const targetMap = options.targetMap || getInvenboardAtomTargetMap(activeSource, preferRecipeAtoms);
        const effectiveCompleted = options.rawCompleted === true ? completedSource : getEffectiveInvenboardCompletedSource(completedSource, activeSource, targetMap);
        const totals = ctx.calculateCostboardAtomTotals(effectiveCompleted, getInvenboardCalculationAtoms(), { ...options, activeSource, preferRecipeAtoms, targetMap });
        if (!preferRecipeAtoms) {
            const target = Math.max(0, targetMap[ctx.VOID_RAY_ATOM] || 0);
            const completed = Math.min(target, Math.max(0, parseInt(effectiveCompleted.get(ctx.VOID_RAY_ID), 10) || 0));
            totals.targetMap[ctx.VOID_RAY_ATOM] = target;
            totals.completedMap[ctx.VOID_RAY_ATOM] = completed;
            totals.remainingMap[ctx.VOID_RAY_ATOM] = Math.max(0, target - completed);
        }
        return totals;
    }

    function updateInvenboardSlotModeButton() {
        const btn = ctx.getEl('invenboardSlotModeBtn');
        if (!btn) return;
        btn.innerHTML = `<span>${ctx._isInvenboardSlotsExpanded ? '핵심재료 전환' : '전체재료 전환'}</span><span class="board-action-icon" aria-hidden="true">▦</span>`;
        btn.setAttribute('aria-pressed', String(ctx._isInvenboardSlotsExpanded));
        btn.title = ctx._isInvenboardSlotsExpanded ? '현재 전체 재료 표시 · 핵심재료로 전환' : '현재 핵심재료 표시 · 전체재료로 전환';
        btn.classList.toggle('is-expanded', ctx._isInvenboardSlotsExpanded);
    }

    function toggleInvenboardSlotMode() {
        if (ctx._currentViewMode !== 'invenboard') return;
        ctx._isInvenboardSlotsExpanded = !ctx._isInvenboardSlotsExpanded;
        ctx._isInvenboardRendered = false;
        const boardEl = ctx.getEl('boardContent');
        if (boardEl) boardEl.innerHTML = '';
        ctx.commitNexusStateChange();
    }

    function ensureInvenboardHeaderActions() {
        const mobileHost = ctx.getEl('invenboardActionsHost');
        if (!mobileHost) return null;
        let actions = ctx.getEl('invenboardHeaderActions');
        if (!actions) {
            actions = document.createElement('div');
            actions.id = 'invenboardHeaderActions';
            actions.className = 'invenboard-actions invenboard-header-actions';
            actions.innerHTML = `<button type="button" class="pc-btn invenboard-complete-all" id="invenboardCompleteAllBtn" data-action="completeAllInvenboardUnits"><span>전체완료</span><span class="board-action-icon" aria-hidden="true">✓</span></button>
                <button type="button" class="pc-btn invenboard-reset" data-action="resetInvenboardAmounts" title="재료 보유량 초기화"><span>보유량 초기화</span><span class="board-action-icon" aria-hidden="true">↺</span></button>
                <button type="button" class="pc-btn invenboard-mode-input" id="invenboardInputModeBtn" data-action="toggleInvenboardInputMode">수동입력 전환</button>
                <button type="button" class="pc-btn invenboard-slot-toggle" id="invenboardSlotModeBtn" data-action="toggleInvenboardSlotMode">전체재료 전환</button>`;
        }
        if (actions.parentElement !== mobileHost) mobileHost.appendChild(actions);
        updateInvenboardSlotModeButton();
        return actions;
    }

    function renderInvenboard() {
        if (ctx._isInvenboardRendered) return;
        const boardEl = ctx.getEl('boardContent');
        if (!boardEl) return;
        ctx._isHiddenboardRendered = false;
        ctx.returnHiddenboardControlsToHeader();
        boardEl.classList.remove('highlight-mode');
        boardEl.classList.add('invenboard-mode');

        const renderCostItem = (atom) => {
            const id = ctx.clean(atom);
            const safeName = ctx.escapeHtml(ctx.getCostboardDisplayName(atom));
            const inputStep = getInvenboardInputStep(id);
            return `<div class="invenboard-item" id="invenboard-${id}" data-inven-id="${id}">
                <div class="invenboard-main">
                    ${ctx.renderInvenboardGradeTag(atom)}
                    <span class="invenboard-name"${ctx.getInvenboardAtomNameStyle(atom)}>${safeName}</span>
                    <button type="button" class="invenboard-tap" data-action="invenboardAdd" data-inven-id="${id}" data-delta="${inputStep}" aria-label="${safeName} ${inputStep}보유">
                        <span class="invenboard-count" id="inven-owned-${id}">-</span>
                    </button>
                    <div class="invenboard-manual-value">
                        <input type="number" class="invenboard-input" id="inven-input-${id}" data-inven-id="${id}" min="0" step="1" inputmode="numeric" pattern="[0-9]*" aria-label="${safeName} 보유량">
                    </div>
                    <span class="invenboard-qty-caption" aria-hidden="true">보유량</span>
                </div>
                <div class="invenboard-controls">
                    <button type="button" class="pc-btn invenboard-plus" data-action="invenboardAdd" data-inven-id="${id}" data-delta="${inputStep}" aria-label="${safeName} ${inputStep}개 보유 추가">+${inputStep}</button>
                    <button type="button" class="pc-btn invenboard-plus invenboard-plus10" data-action="invenboardAdd" data-inven-id="${id}" data-delta="10" aria-label="${safeName} 10개 보유 추가">+10</button>
                </div>
            </div>`;
        };
        const renderCostSlot = ({ atoms }) => {
            const atomList = atoms.filter(Boolean);
            const slotIds = atomList.map(ctx.clean).join(',');
            const slotClass = `invenboard-slot ${ctx.getCostboardSlotToneClass(atomList)}`;
            const tone = ctx.SYSTEM_CONFIG.grades.colors[ctx.getInvenboardAtomGrade(atomList[0])] || '#efd3a4';
            const slotTone = ` style="--card-tone:${tone}"`;
            if (atomList.length === 1) return `<div class="${slotClass}"${slotTone} data-slot-atoms="${slotIds}">${renderCostItem(atomList[0])}</div>`;
            return `<div class="${slotClass} is-split-slot"${slotTone} data-slot-atoms="${slotIds}">${atomList.map(renderCostItem).join('<div class="invenboard-split-divider" aria-hidden="true"></div>')}</div>`;
        };

        boardEl.innerHTML = `<section class="invenboard-workspace" aria-label="재료 보드">
            <header class="invenboard-workspace-heading" aria-label="재료 보드 작업 도구">
                <h2 class="invenboard-workspace-title">재료 보드</h2>
                <div id="invenboardActionsHost" class="invenboard-actions-host"></div>
            </header>
            <div class="invenboard-workspace-body">
                <div id="invenboardEmpty" class="empty-msg"></div>
                <div class="invenboard-grid" id="invenboardGrid">${getInvenboardSlotDefs().map(renderCostSlot).join('')}</div>
            </div>
        </section>`;
        ensureInvenboardHeaderActions();
        ctx._isInvenboardRendered = true;
    }

    function getInvenboardMaxQty(id, totals = calculateInvenboardCostboardTotals()) {
        if (!getInvenboardSlotIdSet().has(id)) return 0;
        if (id === ctx.VOID_RAY_ID) return Math.max(0, totals.targetMap[ctx.VOID_RAY_ATOM] || 0);
        return Math.max(0, totals.targetMap[ctx.getCostboardAtomRawName(id)] || 0);
    }

    function getDirectInvenboardAtomNeed(uid, qty = 1) {
        const amount = Math.max(1, parseInt(qty, 10) || 1);
        const cacheKey = `${ctx._isInvenboardSlotsExpanded ? 'expanded' : 'core'}:${uid}:${amount}`;
        if (ctx._directInvenboardAtomNeedCache.has(cacheKey)) return new Map(ctx._directInvenboardAtomNeedCache.get(cacheKey));
        const { targetMap } = calculateInvenboardCostboardTotals(new Map(), { activeSource: new Map([[uid, amount]]), rawCompleted: true });
        const need = new Map(getInvenboardAtoms().map(atom => [ctx.clean(atom), Math.max(0, targetMap[atom] || 0)]).filter(([, n]) => n > 0));
        ctx._directInvenboardAtomNeedCache.set(cacheKey, need); ctx.limitCacheSize(ctx._directInvenboardAtomNeedCache, 512);
        return new Map(need);
    }

    function getInvenboardOwnedAtomMap({ directOnly = false } = {}) {
        const available = new Map();
        if (!directOnly) {
            const totals = calculateInvenboardCostboardTotals();
            getInvenboardAtoms().forEach(atom => {
                const qty = Math.max(0, parseInt(totals.completedMap[atom], 10) || 0);
                if (qty > 0) available.set(ctx.clean(atom), qty);
            });
            return available;
        }

        const effectiveCompleted = getEffectiveInvenboardCompletedSource(ctx.completedUnits);
        getInvenboardAtoms().forEach(atom => {
            const id = ctx.clean(atom);
            const qty = Math.max(0, parseInt(effectiveCompleted.get(id), 10) || 0);
            if (qty > 0) available.set(id, qty);
        });
        return available;
    }

    function getCompletedRecipeProgress(uid, qty) {
        const unit = ctx.unitMap.get(uid);
        if (!unit?.parsedRecipe?.length) return { hasRecipe: false, hasAnyCompleted: false, hasEnoughCompleted: false };
        let hasAnyCompleted = false;
        const hasEnoughCompleted = unit.parsedRecipe.every(child => {
            if (!child.id || ctx.isAutoRecipeRequirementSatisfied(child.id)) return true;
            const needQty = (ctx.isToolRequirement(uid, child.id) ? 1 : child.qty) * qty;
            const completedQty = Math.max(0, parseInt(ctx.completedUnits.get(child.id), 10) || 0);
            if (completedQty > 0) hasAnyCompleted = true;
            return completedQty >= needQty;
        });
        return { hasRecipe: true, hasAnyCompleted, hasEnoughCompleted };
    }

    function getInvenboardMaterialCompletionCandidates(baseMap) {
        const depths = ctx.getBoardDependencyDepths();
        return [...baseMap.entries()]
            .filter(([uid, qty]) =>
                qty > 0 &&
                ctx.unitMap.has(uid) &&
                !ctx.activeUnits.has(uid) &&
                !ctx.completedTargets.has(uid) &&
                !ctx.ALL_INVENBOARD_SLOT_SET.has(uid) &&
                (depths.get(uid) || 0) > 0
            )
            .map(([uid, qty]) => ({
                unit: ctx.unitMap.get(uid),
                qty,
                depth: depths.get(uid) || 0
            }))
            .sort((a, b) =>
                b.depth - a.depth ||
                ctx.getGradeIndex(a.unit.grade) - ctx.getGradeIndex(b.unit.grade) ||
                a.unit.name.localeCompare(b.unit.name)
            );
    }

    function getDirectInvenboardReadyQty(uid, maxQty, available = getInvenboardOwnedAtomMap({ directOnly: true })) {
        const limit = Math.max(0, parseInt(maxQty, 10) || 0);
        if (limit <= 0) return 0;
        const perUnitNeed = getDirectInvenboardAtomNeed(uid, 1);
        if (perUnitNeed.size === 0) return 0;
        let readyQty = limit;
        perUnitNeed.forEach((amount, id) => {
            if (ctx.AUTO_RECIPE_REQUIREMENT_SET.has(id)) return;
            const need = Math.max(1, parseInt(amount, 10) || 1);
            readyQty = Math.min(readyQty, Math.floor((available.get(id) || 0) / need));
        });
        return Math.max(0, readyQty);
    }

    function consumeAvailableInvenboardAtoms(available, uid, qty) {
        const amount = Math.max(0, parseInt(qty, 10) || 0);
        if (amount <= 0) return;
        getDirectInvenboardAtomNeed(uid, 1).forEach((needQty, id) => {
            if (ctx.AUTO_RECIPE_REQUIREMENT_SET.has(id)) return;
            const usedQty = Math.max(0, parseInt(needQty, 10) || 0) * amount;
            const remain = Math.max(0, (available.get(id) || 0) - usedQty);
            if (remain > 0) available.set(id, remain);
            else available.delete(id);
        });
    }

    function completeInvenboardMaterialUnitsIfReady() {
        const candidates = getInvenboardMaterialCompletionCandidates(ctx.calculateBoardRequirements().baseMap);
        if (!candidates.length) return false;
        let changed = false;
        const available = getInvenboardOwnedAtomMap({ directOnly: true });

        for (const { unit, qty: requiredQty } of candidates) {
            const uid = unit.id;
            const currentCompleted = Math.max(0, parseInt(ctx.completedUnits.get(uid), 10) || 0);
            const remainingQty = Math.max(0, requiredQty - currentCompleted);
            if (remainingQty <= 0) continue;

            if (ctx.isInvenboardInstantCompleteUnit(uid)) {
                ctx.addCompletedMaterialUnit(uid, remainingQty, { trackInvenboard: true });
                changed = true;
                continue;
            }

            const recipeReadyQty = ctx.getCompletedRecipeReadyQty(uid, remainingQty);
            if (recipeReadyQty > 0) {
                ctx.deleteCompletedRecipe(uid, recipeReadyQty);
                ctx.addCompletedMaterialUnit(uid, recipeReadyQty, { trackInvenboard: true });
                changed = true;
                continue;
            }

            const recipeProgress = getCompletedRecipeProgress(uid, 1);
            if (recipeProgress.hasAnyCompleted) continue;
            const directReadyQty = getDirectInvenboardReadyQty(uid, remainingQty, available);
            if (directReadyQty <= 0) continue;
            ctx.resetInvenboardOwnedForUnit(uid, directReadyQty);
            consumeAvailableInvenboardAtoms(available, uid, directReadyQty);
            ctx.addCompletedMaterialUnit(uid, directReadyQty, { trackInvenboard: true });
            changed = true;
        }
        return changed;
    }

    function completeInvenboardTargetsIfReady() {
        if (ctx._currentViewMode !== 'invenboard') return false;
        let changed = completeInvenboardMaterialUnitsIfReady();
        if (ctx.activeUnits.size === 0) return changed;
        const available = getInvenboardOwnedAtomMap({ directOnly: true });
        const targets = ctx.getUnitsFromMap(ctx.activeUnits);
        targets.forEach(unit => {
            const uid = unit.id;
            if (!ctx.activeUnits.has(uid)) return;
            const activeQty = ctx.activeUnits.get(uid) || 1;
            const recipeReadyQty = ctx.getCompletedRecipeReadyQty(uid, activeQty);
            const directReadyQty = getDirectInvenboardReadyQty(uid, activeQty, available);
            const hasAutoCompletedCostOnly = unit.parsedCost?.length && unit.parsedCost.every(pc => ctx.AUTO_COST_SLOT_SET.has(pc.key) && !ctx.COSTBOARD_ATOM_ID_SET.has(pc.key));
            const completeInstantly = ctx.isInvenboardInstantCompleteUnit(uid);
            const completeWithRecipe = recipeReadyQty >= activeQty;
            const completeWithDirectAtoms = completeInstantly || (!getCompletedRecipeProgress(uid, 1).hasAnyCompleted && (directReadyQty >= activeQty || (hasAutoCompletedCostOnly && getDirectInvenboardAtomNeed(uid, 1).size === 0)));
            if (!completeWithRecipe && !completeWithDirectAtoms) return;

            if (completeWithRecipe) {
                ctx.deleteCompletedRecipe(uid, activeQty);
            } else if (!completeInstantly) {
                ctx.resetInvenboardOwnedForUnit(uid, activeQty);
                consumeAvailableInvenboardAtoms(available, uid, activeQty);
            }
            ctx.completedTargets.set(uid, activeQty);
            ctx.activeUnits.delete(uid);
            ctx.pausedUnits.delete(uid);
            ctx.completedUnits.delete(uid);
            ctx._invenboardAutoCompletedUnits.delete(uid);
            changed = true;
        });

        if (!changed) return false;
        ctx._currentHighlight = null;
        return true;
    }

    function setInvenboardAmount(id, qty, options = {}) {
        const cleanId = ctx.normalizeSavedId(id);
        if (!getInvenboardSlotIdSet().has(cleanId)) return;
        const totals = calculateInvenboardCostboardTotals();
        const maxQty = getInvenboardMaxQty(cleanId, totals);
        const rawQty = normalizeInvenboardAmount(qty, Number.MAX_SAFE_INTEGER);
        const nextQty = normalizeInvenboardAmount(rawQty, maxQty);
        if (nextQty > 0) ctx.completedUnits.set(cleanId, nextQty);
        else ctx.completedUnits.delete(cleanId);
        if (options.preserveOverflow && rawQty > nextQty && maxQty > 0) ctx._invenboardManualInputs.set(cleanId, rawQty);
        else ctx._invenboardManualInputs.delete(cleanId);
        completeInvenboardTargetsIfReady();
        ctx.commitNexusStateChange();
    }

    function changeInvenboardAmount(id, delta) {
        const cleanId = ctx.normalizeSavedId(id);
        if (!getInvenboardSlotIdSet().has(cleanId)) return;
        const currentQty = ctx.completedUnits.get(cleanId) || 0;
        setInvenboardAmount(cleanId, currentQty + (parseInt(delta, 10) || 0));
    }

    function toggleInvenboardInputMode() {
        ctx._invenboardInputMode = ctx._invenboardInputMode === 'manual' ? 'auto' : 'manual';
        updateInvenboard();
    }

    function resetInvenboardAmounts() {
        let changed = false;
        ctx.ALL_INVENBOARD_SLOT_SET.forEach(id => {
            if (ctx.completedUnits.has(id)) {
                ctx.completedUnits.delete(id);
                changed = true;
            }
        });

        if (ctx.resetInvenboardAutoCompletedUnits()) changed = true;
        if (ctx.clearInvenboardManualInputs()) changed = true;

        const completedTargetEntries = Array.from(ctx.completedTargets.entries());
        if (completedTargetEntries.length > 0) {
            ctx.completedTargets.clear();
            completedTargetEntries.forEach(([uid, qty]) => {
                if (!ctx.unitMap.has(uid)) return;
                const restoreQty = qty || 1;
                ctx.completedUnits.delete(uid);
                ctx.setActiveUnitQty(uid, restoreQty);
            });
            changed = true;
        }

        if (!changed) return;
        ctx.commitNexusStateChange({ clearHighlight: true });
    }

    function completeAllInvenboardUnits() {
        if (ctx._currentViewMode !== 'invenboard' || ctx.activeUnits.size === 0) return;
        const totals = calculateInvenboardCostboardTotals();
        ctx.ALL_INVENBOARD_SLOT_SET.forEach(id => ctx.completedUnits.delete(id));
        ctx.clearInvenboardManualInputs();
        getInvenboardAtoms().forEach(atom => {
            const qty = Math.max(0, parseInt(totals.targetMap[atom], 10) || 0);
            if (qty > 0) ctx.completedUnits.set(ctx.clean(atom), qty);
        });
        const voidQty = getInvenboardMaxQty(ctx.VOID_RAY_ID, totals);
        if (voidQty > 0) ctx.completedUnits.set(ctx.VOID_RAY_ID, voidQty);
        const targets = Array.from(ctx.activeUnits.entries()).filter(([uid]) => ctx.unitMap.has(uid));
        if (targets.length === 0) return;
        targets.forEach(([uid, qty]) => {
            ctx.completedTargets.set(uid, ctx.normalizeUnitQty(uid, qty) || 1);
            ctx.activeUnits.delete(uid);
            ctx.pausedUnits.delete(uid);
        });
        ctx.commitNexusStateChange({ clearHighlight: true });
    }

    function updateInvenboard(costboardTotals = null) {
        if (!ctx._isInvenboardRendered) return;
        const boardEl = ctx.getEl('boardContent');
        if (!boardEl) return;
        boardEl.classList.add('invenboard-mode');
        const totals = costboardTotals || calculateInvenboardCostboardTotals();
        const isManual = ctx._invenboardInputMode === 'manual';

        getInvenboardAtoms().forEach(atom => {
            const id = ctx.clean(atom);
            const needQty = Math.max(0, totals.targetMap[atom] || 0);
            const directRawQty = Math.max(0, parseInt(ctx.completedUnits.get(id), 10) || 0);
            const directOwnedQty = Math.min(directRawQty, needQty);
            const manualInputQty = Math.max(0, parseInt(ctx._invenboardManualInputs.get(id), 10) || 0);
            const shownInputQty = Math.max(manualInputQty, directRawQty);
            const ownedQty = Math.max(directOwnedQty, Math.max(0, parseInt(totals.completedMap[atom], 10) || 0));
            const isDisabled = needQty <= 0 && ownedQty <= 0;
            const isOverLimit = isManual && needQty > 0 && shownInputQty > needQty;
            const remainQty = Math.max(0, needQty - Math.min(ownedQty, needQty));
            const item = ctx.getEl(`invenboard-${id}`);
            if (!item) return;
            item.classList.toggle('active', !isDisabled);
            item.classList.toggle('is-disabled', isDisabled);
            item.classList.toggle('is-completed', ownedQty > 0 && remainQty === 0);
            item.classList.toggle('is-manual', isManual);
            item.classList.toggle('is-over-limit', isOverLimit);

            const countEl = ctx.getEl(`inven-owned-${id}`);
            const input = ctx.getEl(`inven-input-${id}`);
            const tapBtn = item.querySelector('.invenboard-tap');
            const plusBtns = item.querySelectorAll('.invenboard-plus');
            const plus10 = item.querySelector('.invenboard-plus10');

            if (countEl) {
                countEl.textContent = isDisabled ? '-' : String(ownedQty);
            }
            if (input) {
                const displayQty = isManual ? shownInputQty : ownedQty;
                if (isDisabled || document.activeElement !== input) input.value = isDisabled ? '' : String(displayQty);
                input.placeholder = isDisabled ? '-' : '';
                input.max = String(Math.max(0, needQty));
                input.readOnly = !isManual || needQty <= 0;
                input.disabled = !isManual || isDisabled;
                input.tabIndex = isManual && needQty > 0 ? 0 : -1;
                input.classList.toggle('is-over-limit', isOverLimit);
                input.title = isOverLimit ? `필요량 ${needQty} 초과: 계산에는 ${needQty}까지만 반영됩니다.` : '';
                input.setAttribute('aria-invalid', isOverLimit ? 'true' : 'false');
            }
            if (tapBtn) tapBtn.disabled = isManual || needQty <= 0 || remainQty <= 0;
            plusBtns.forEach(btn => { btn.disabled = needQty <= 0 || remainQty <= 0; });
            if (plus10) plus10.disabled = needQty <= 0 || remainQty < 10;
        });

        boardEl.querySelectorAll('.invenboard-slot').forEach(slot => {
            const hasActive = !!slot.querySelector('.invenboard-item.active');
            slot.classList.toggle('active', hasActive);
            slot.classList.toggle('has-active', hasActive);
        });

        const modeBtn = ctx.getEl('invenboardInputModeBtn');
        if (modeBtn) {
            modeBtn.innerHTML = `<span>${isManual ? '자동입력 전환' : '수동입력 전환'}</span><span class="board-action-icon" aria-hidden="true">⇄</span>`;
            modeBtn.setAttribute('aria-pressed', String(isManual));
            modeBtn.title = isManual ? '현재 수동입력 · 자동입력으로 전환' : '현재 자동입력 · 수동입력으로 전환';
            modeBtn.classList.toggle('is-manual', isManual);
        }
        updateInvenboardSlotModeButton();
        const completeAllBtn = ctx.getEl('invenboardCompleteAllBtn');
        if (completeAllBtn) completeAllBtn.disabled = ctx.activeUnits.size === 0;
        const empty = ctx.getEl('invenboardEmpty');
        if (empty) {
            const isEmpty = ctx.activeUnits.size === 0 && ctx.completedTargets.size === 0;
            empty.style.display = isEmpty ? 'block' : 'none';
            if (isEmpty) empty.innerHTML = `<div class="empty-msg-enhanced"><div class="empty-main">유닛도감에서 유닛을 선택하세요</div></div>`;
        }
    }
    return { calculateInvenboardCostboardTotals, changeInvenboardAmount, completeAllInvenboardUnits, completeInvenboardTargetsIfReady, getInvenboardAtoms, renderInvenboard, resetInvenboardAmounts, setInvenboardAmount, toggleInvenboardInputMode, toggleInvenboardSlotMode, updateInvenboard };
};
