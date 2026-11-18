window.NEXUS_CHECKLIST = function createChecklist(ctx) {
    'use strict';
    const { setHTMLIfChanged } = ctx;

    /* ── 01 · 카드·페이지 DOM 재사용 ── */

    function reconcileChildren(parent, children) {
        let cursor = parent.firstElementChild;
        for (const child of children) {
            if (child === cursor) cursor = cursor.nextElementSibling;
            else parent.insertBefore(child, cursor);
        }
        while (cursor) { const next = cursor.nextElementSibling; cursor.remove(); cursor = next; }
    }

    function updateGridPages(grid, items, onlyVisible) {
        const pageSize = CHECKLIST_MOBILE_PAGING.matches ? 3 : 6;
        const key = `${pageSize}|` + items.map(el => `${el.id}:${onlyVisible && el.style.display === 'none' ? 0 : 1}`).join('|');
        if (grid._pageKey === key) return;
        const shown = onlyVisible ? items.filter(el => el.style.display !== 'none') : items;
        const hidden = onlyVisible ? items.filter(el => el.style.display === 'none') : [];
        const pages = Array.from(grid.children).filter(el => el.classList.contains('checklist-page'));
        const nextPages = [];
        for (let i = 0; i < shown.length; i += pageSize) {
            const page = pages[i / pageSize] || document.createElement('div');
            page.className = 'checklist-page';
            reconcileChildren(page, shown.slice(i, i + pageSize));
            nextPages.push(page);
        }
        reconcileChildren(grid, [...hidden, ...nextPages]);
        grid._pageKey = key;
    }

    /* ── 02 · 보드 생성·작업 버튼 배치 ── */
    const CHECKLIST_MOBILE_PAGING = window.matchMedia('(max-width:767px), (min-width:768px) and (max-width:950px) and (max-height:520px) and (orientation:landscape)');
    CHECKLIST_MOBILE_PAGING.addEventListener('change', () => updateChecklist());

    function renderChecklist() {
        if (ctx._isChecklistRendered) return;
        const boardEl = ctx.getEl('checklistContent');
        if (!boardEl) return;

        const renderChecklistSlot = (id, n, g) => {
            const unit = ctx.unitMap.get(id);
            const essenceText = ctx.getUnitUnitboardEssenceText(unit);
            const noticeHtml = ctx.getUnitCardNotesHtml(unit);
            return `<div class="checklist-slot" id="d-slot-wrap-${id}" data-uid="${id}" data-detail-view="usage"><div class="d-slot-main"><div class="d-name"><div class="d-grade-row"><div class="d-grade-left"><span class="gtag grade-${g}">${g}</span></div><div class="d-grade-actions"><button type="button" class="d-target-badge" data-action="toggleHighlight" data-uid="${id}" aria-pressed="false" hidden>조합추적</button><span class="d-material-ready" hidden><span class="d-material-ready-star" aria-hidden="true">✦</span>완료 준비됨</span></div></div><div class="d-name-line"><span class="d-name-inline">${n}${ctx.CLEAN_SPECIAL_CONDITIONS[id]?`<span class="badge-special-cond recipe-cond-offset">특수조건</span>`:''}</span></div>${noticeHtml}${essenceText}</div></div><div id="d-cond-${id}" class="d-cond-inline"></div><div class="d-detail-wrap"><div class="d-detail-toolbar"><div class="d-detail-tabs" role="group" aria-label="${n} 표시 정보"><button type="button" class="d-detail-tab is-active" data-action="switchChecklistDetail" data-uid="${id}" data-detail-view="usage" aria-pressed="true" aria-controls="d-reason-${id}">상위조합</button><button type="button" class="d-detail-tab" data-action="switchChecklistDetail" data-uid="${id}" data-detail-view="recipe" aria-pressed="false" aria-controls="d-recipe-${id}">조합법</button></div><span class="d-detail-meta d-usage-hint" title="상위조합의 유닛명을 선택하면 해당 조합을 추적합니다">선택 시 추적 ↗</span><span class="d-detail-meta d-recipe-meta"></span></div><div class="d-detail-panels"><div class="d-reason-wrap" id="d-reason-${id}" aria-hidden="false"></div><div class="d-recipe-wrap" id="d-recipe-${id}" aria-hidden="true" inert></div></div></div><div class="d-goal-recipe-wrap" id="d-goal-recipe-${id}"></div><div id="craft-wrap-${id}" class="craft-wrap"></div></div>`;
        };
        const getGrp = (id, pid, title, resetLevel, isCol, alwaysShow, alwaysOpen, resetLabel) => `
            <div class="checklist-group" id="${id}" style="${alwaysShow ? '' : 'display:none;'}" ${alwaysShow ? 'data-always-show="true"' : ''} ${alwaysOpen ? 'data-always-open="true"' : ''}>
                <div class="checklist-group-title" data-action="toggleGroup" data-grid-id="${pid}">
                    <div class="grp-title-main">
                        <span class="grp-toggle-icon" style="transform:${isCol?'rotate(-90deg)':'rotate(0deg)'};">▼</span>
                        <span>${title}</span>
                        ${resetLevel > 0 ? `<span class="grp-count-badge" id="grp-count-${pid}"></span>` : ''}
                    </div>
                    <div class="grp-title-actions" id="${id}-actions">
                        ${resetLevel > 0 ? `<button type="button" class="btn-text-link" data-action="completeGroup" data-level="${resetLevel}" title="${getGroupCompleteDescription(resetLevel)}" disabled><span class="group-complete-label">${resetLabel.replace(/복구$/, '완료')}</span><span class="action-icon" aria-hidden="true">✓</span></button><button type="button" class="btn-text-link" data-action="resetGroup" data-level="${resetLevel}" title="${getGroupRestoreDescription(resetLevel)}" disabled><span>${resetLabel}</span><span class="action-icon" aria-hidden="true">↺</span></button>` : ''}
                    </div>
                </div>
                <div class="checklist-grid" id="${pid}" ${isCol?'style="display:none;"':''}></div>
            </div>`;

        const unitSlots = Array.from(ctx.unitMap.values())
            .filter(u => ctx.getGradeIndex(u.grade) >= ctx.getGradeIndex(ctx.SYSTEM_CONFIG.policy.minGradeForChecklist) && !ctx.AUTO_COST_SLOT_SET.has(u.id))
            .map(u => renderChecklistSlot(u.id, u.name, u.grade)).join('');

        const _exIds = new Set((ctx.SYSTEM_CONFIG.policy.hideCompletedExcludeGroups || []).map(t => ctx.titleToGridId[t]).filter(Boolean));

        returnChecklistControlsToHeader();
        boardEl.innerHTML = `<div id="checklist-empty-msg" class="empty-msg"></div><div id="checklist-slot-pool" class="checklist-slot-pool">${unitSlots}</div>` + ctx.GROUP_DEFS.map(g => getGrp(g.id, g.pid, g.title, g.resetLevel, g.isCol, g.alwaysShow, g.alwaysOpen, g.resetLabel)).join('');
        boardEl.dataset.excludeGridIds = JSON.stringify([..._exIds]);
        ctx._checklistSlotElsByUid.clear();
        boardEl.querySelectorAll('.checklist-slot[data-uid]').forEach(el => ctx._checklistSlotElsByUid.set(el.dataset.uid, el));
        ctx._isChecklistRendered = true;
        placeChecklistControls();
    }

    function mountChecklistControls(actions, host, inGroup) {
        if (actions.parentElement !== host) {
            if (inGroup) host.insertBefore(actions, host.firstChild);
            else host.appendChild(actions);
        }
        actions.classList.toggle('checklist-actions-in-group', inGroup);
        actions.classList.toggle('checklist-actions-in-header', !inGroup);
    }

    function returnChecklistControlsToHeader() {
        const actions = ctx.getEl('checklistGlobalActions');
        const header = ctx.getEl('checklistMobileHeader');
        if (actions && header) mountChecklistControls(actions, header, false);
    }

    function placeChecklistControls() {
        const actions = ctx.getEl('checklistGlobalActions');
        const header = ctx.getEl('checklistMobileHeader');
        const desktopHost = ctx.getEl('group-target-actions');
        const targetGroup = ctx.getEl('group-target');
        if (!actions || !header) return;
        const inGroup = !CHECKLIST_MOBILE_PAGING.matches && !!desktopHost && targetGroup?.style.display !== 'none';
        mountChecklistControls(actions, inGroup ? desktopHost : header, inGroup);
        header.classList.toggle('checklist-ph-no-target', !inGroup && !CHECKLIST_MOBILE_PAGING.matches);
    }

    /* ── 03 · 조합법·상위조합·조건 표시 ── */

    function getChecklistRecipeQuantity(id, calcResult) {
        const unit = ctx.unitMap.get(id);
        const { reqMap, baseMap } = calcResult || ctx._lastCalcResult || ctx.calculateBoardRequirements();
        const requested = ctx.activeUnits.has(id)
            ? (baseMap.get(id) || ctx.activeUnits.get(id) || 0)
            : (reqMap.get(id) || 0);
        const multi = ctx.isOneTime(unit) ? 1 : Math.max(requested, 1);
        const qtyLimit = ctx.getUnitQtyLimit(id);
        const hasSpecialLimit = ctx.isOneTime(unit) || !!ctx.CLEAN_UNIT_QTY_CAPS[id];
        const countLabel = hasSpecialLimit
            ? (multi === qtyLimit ? `${qtyLimit}개 제한` : `${multi}개 기준 · 최대 ${qtyLimit}개 제한`)
            : `${multi}개 기준`;
        return { multi, countLabel };
    }

    function renderChecklistRecipe(slotEl, calcResult) {
        const id = slotEl.dataset.uid;
        const unit = ctx.unitMap.get(id);
        if (!unit) return;
        const isGoal = slotEl.classList.contains('is-final-goal');
        const recipeEl = slotEl.querySelector(isGoal ? '.d-goal-recipe-wrap' : '.d-recipe-wrap');
        if (!recipeEl) return;
        const { multi, countLabel } = getChecklistRecipeQuantity(id, calcResult);
        const renderKey = `${multi}:${countLabel}`;
        if (recipeEl._renderKey === renderKey) return;
        if (isGoal) {
            recipeEl.innerHTML = `<div class="uc-recipe-area"><span class="recipe-label">조합 조건<span class="d-recipe-count">${multi}개 기준</span></span>${ctx.formatRecipe(unit, multi)}</div>`;
        } else {
            slotEl.querySelector(".d-recipe-meta").textContent = `${unit.name} · ${countLabel}`;
            recipeEl.innerHTML = `<div class="d-recipe-content">${ctx.formatRecipe(unit, multi, true)}</div>`;
        }
        recipeEl._renderKey = renderKey;
    }

    function switchChecklistDetail(id, view, calcResult = null) {
        const slotEl = ctx._checklistSlotElsByUid.get(id);
        if (!slotEl || slotEl.classList.contains('is-final-goal')) return;
        const activeView = view === 'recipe' ? 'recipe' : 'usage';
        if (slotEl.dataset.detailView !== activeView) slotEl.dataset.detailView = activeView;
        slotEl.querySelectorAll('.d-detail-tab').forEach(tab => {
            const selected = tab.dataset.detailView === activeView;
            tab.classList.toggle('is-active', selected);
            if (tab.getAttribute('aria-pressed') !== String(selected)) tab.setAttribute('aria-pressed', String(selected));
        });
        // 선택된 정보 패널만 표시하고 다른 패널의 클릭을 비활성화합니다.
        for (const [panel, selected] of [
            [slotEl.querySelector('.d-reason-wrap'), activeView === 'usage'],
            [slotEl.querySelector('.d-recipe-wrap'), activeView === 'recipe']
        ]) {
            if (!panel) continue;
            if (panel.getAttribute('aria-hidden') !== String(!selected)) panel.setAttribute('aria-hidden', String(!selected));
            if (panel.inert !== !selected) panel.inert = !selected;
        }
        renderChecklistRecipe(slotEl, calcResult);
    }

    function getChecklistReasonDisplayEntries(slotId, rMap, reqMap) {
        const getReasonParentNeed = (info) => {
            if (!info?.parentUid) return 0;
            return Math.max(0, reqMap.get(info.parentUid) || 0);
        };
        const getReasonBaseQty = (rId, info) => {
            if (!info || info.depth === 0 || !info.reqQty) return 0;
            const parentNeed = getReasonParentNeed(info);
            if (parentNeed <= 0) return 0;
            return rId.startsWith('TOOL_') ? 1 : (info.reqQty || 1) * parentNeed;
        };
        if (!rMap) return [];
        const entries = [...rMap.entries()].map(([rId, info], index) => {
            const baseQty = getReasonBaseQty(rId, info);
            return { rId, info, index, baseQty, displayQty: info?.depth === 0 ? 0 : baseQty };
        });
        let remainingCompleted = Math.max(0, ctx.completedUnits.get(slotId) || 0);
        entries
            .filter(entry => entry.baseQty > 0)
            .sort((a, b) => a.baseQty - b.baseQty || a.index - b.index)
            .forEach(entry => {
                if (remainingCompleted <= 0) return;
                const consumed = Math.min(entry.displayQty, remainingCompleted);
                entry.displayQty -= consumed;
                remainingCompleted -= consumed;
            });
        return entries
            .filter(entry => entry.info?.depth === 0 || entry.displayQty > 0)
            .map(entry => [entry.rId, { ...entry.info, displayQty: entry.displayQty, _reasonOrder: entry.index }]);
    }

    function renderChecklistSlotReasons({ id, slotEl, needed, isTarget, isMergedSlot, reasonMap, getCachedReasonEntries, targetHighlight, highlightDeps }) {
        const getReasonTagClass = (info) => info?.tagClass || ctx.DEFAULT_REASON_TAG_CLASS;
        const isSplitReason = (info) => info?.depth !== 0 && !!info?.reasonCenterHtml;
        const renderReasonTagContent = (info) => {
            if (!isSplitReason(info)) return info.text;
            return [
                `<span class="d-reason-grade">${ctx.escapeHtml(info.reasonGrade || '')}</span>`,
                `<span class="d-reason-main">${info.reasonCenterHtml}</span>`,
                `<span class="d-reason-qty">×${info.displayQty}</span>`
            ].join('');
        };
        
        const rCon = slotEl.querySelector(`#d-reason-${id}`);
        if (rCon) {
            const rMap = reasonMap.get(id);
            if (rMap && rMap.size > 0 && needed > 0) {
                let allEntries = getCachedReasonEntries(id, rMap).filter(([, info]) => info.depth !== 0);
                if (isTarget && !isMergedSlot) allEntries = [];
                if (ctx._currentHighlight) {
                    const filtered = allEntries.filter(([, i]) =>
                        i.parentUid === targetHighlight ||
                        (highlightDeps && highlightDeps.has(i.parentUid))
                    );
                    allEntries = filtered;
                }
                if (allEntries.length > 0) {
                    const sorted = allEntries.sort((a, b) =>
                        (a[1].depth || 0) - (b[1].depth || 0) ||
                        (a[1].reasonGradeRank ?? ctx.REASON_GRADE_ORDER.length) - (b[1].reasonGradeRank ?? ctx.REASON_GRADE_ORDER.length) ||
                        (a[1]._reasonOrder || 0) - (b[1]._reasonOrder || 0)
                    );
                    rCon.classList.toggle('is-target-only', sorted.every(([, info]) => info.depth === 0));
                    setHTMLIfChanged(rCon, sorted.map(([rId, info]) => {
                        const splitTagClass = isSplitReason(info) ? ' is-split-reason' : '';
                        return `<button type="button" class="d-reason-tag ${getReasonTagClass(info)}${splitTagClass}" data-action="toggleHighlight" data-uid="${rId.replace(/^(TARGET_|MAT_|TOOL_|AUTO_)/,'')}">${renderReasonTagContent(info)}</button>`;
                    }).join(''));
                } else {
                    rCon.classList.remove('is-target-only');
                    setHTMLIfChanged(rCon, '');
                }
            } else {
                rCon.classList.remove('is-target-only');
                setHTMLIfChanged(rCon, '');
            }
        }

        const cEl = slotEl.querySelector(`#d-cond-${id}`);
        if (cEl) {
            const rMap = reasonMap.get(id);
            const condMap = new Map();

            if (rMap) {
                getCachedReasonEntries(id, rMap).forEach(([, info]) => {
                    if (!info.cond || info.displayQty <= 0) return;
                    if (ctx._currentHighlight) {
                        const pUid = info.parentUid;
                        if (pUid !== targetHighlight && (!highlightDeps || !highlightDeps.has(pUid))) return;
                    }
                    const cleanCond = ctx.formatConditionText(info.cond);
                    if (!cleanCond) return;
                    condMap.set(cleanCond, (condMap.get(cleanCond) || 0) + info.displayQty);
                });
            }

            if (condMap.size > 0) {
                cEl.style.display = 'flex';
                setHTMLIfChanged(cEl, '<span class="recipe-label">조합 조건</span>' + Array.from(condMap, ([condStr, qty]) => `<div class="d-condition-row"><span class="d-cond-text">${ctx.escapeHtml(condStr)}</span><span class="d-cond-qty">${qty}개</span></div>`).join(''));
            } else {
                cEl.style.display = 'none';
                setHTMLIfChanged(cEl, '');
            }
        }
    }

    /* ── 04 · 재료 깊이·정렬·그룹 표시 ── */

    const BASIC_CHECKLIST_GRADES = new Set(["레어", "에픽", "유니크", "헬", "레전드"]);

    const isBasicChecklistGrade = (grade) => BASIC_CHECKLIST_GRADES.has(grade);

    function getChecklistDepths(mergedSlots) {
        const exactDepths = new Map();
        let queue = [];
        ctx.activeUnits.forEach((_, uid) => {
            if (!mergedSlots.has(uid)) {
                exactDepths.set(uid, 0);
                queue.push(uid);
            }
        });
        if (queue.length === 0) {
            ctx.activeUnits.forEach((_, uid) => {
                exactDepths.set(uid, 0);
                queue.push(uid);
            });
        }
        let curDepth = 0;
        while(queue.length > 0 && curDepth < 30) {
            let nextQueue = [];
            curDepth++;
            for (let uid of queue) {
                const u = ctx.unitMap.get(uid);
                if (!u) continue;
                u.parsedRecipe?.forEach(pr => {
                    if (pr.id && !exactDepths.has(pr.id)) {
                        exactDepths.set(pr.id, curDepth);
                        nextQueue.push(pr.id);
                    }
                });
                ctx.getToolNeed(uid).forEach(toolId => {
                    if (toolId && !exactDepths.has(toolId)) {
                        exactDepths.set(toolId, curDepth);
                        nextQueue.push(toolId);
                    }
                });
                u.parsedCost?.forEach(pc => {
                    if (ctx.AUTO_COST_SLOT_SET.has(pc.key) && !exactDepths.has(pc.key)) {
                        exactDepths.set(pc.key, curDepth);
                        nextQueue.push(pc.key);
                    }
                });
            }
            queue = nextQueue;
        }

        return exactDepths;
    }

    function sortChecklistGrids(grids, slotsByGrid, onlyVisible) {
        [grids.target, grids.special, grids.upperHidden, grids.basicHidden].forEach(grid => {
            if (!grid) return;
            const children = slotsByGrid.get(grid) || [];
            children.sort((a, b) => {
                const uidA = a.dataset.uid || a.id.replace('d-slot-wrap-','');
                const uidB = b.dataset.uid || b.id.replace('d-slot-wrap-','');
                const uA = ctx.unitMap.get(uidA);
                const uB = ctx.unitMap.get(uidB);
                if (grid === grids.upperHidden) {
                    const levelDiff = (ctx._unitNativeLevels.get(uidB) || 1) - (ctx._unitNativeLevels.get(uidA) || 1);
                    if (levelDiff !== 0) return levelDiff;
                }
                const priority = (ctx.SYSTEM_CONFIG.sorting.order[uB?.name]||0) - (ctx.SYSTEM_CONFIG.sorting.order[uA?.name]||0);
                return ctx.getGradeIndex(uB?.grade) - ctx.getGradeIndex(uA?.grade) ||
                       priority || (uA?.name || uidA).localeCompare(uB?.name || uidB);
            });
            updateGridPages(grid, children, onlyVisible);
        });
    }

    function updateChecklistGroupVisibility(grids, targetHighlight, excludeGridIds) {
        Object.values(grids).forEach(g => {
            if (!g) return;
            const grp = g.closest('.checklist-group'), icon = grp?.querySelector('.grp-toggle-icon');
            if (!grp) return;
            
            const slots = Array.from(g.querySelectorAll('.checklist-slot'));
            const visibleSlots = slots.filter(el => el.style.display !== 'none');

            if (targetHighlight) {
                grp.style.display = visibleSlots.length > 0 ? 'block' : 'none';
                if (visibleSlots.length > 0) {
                    grp.classList.remove('collapsed');
                    g.style.display = 'grid';
                    if (icon) icon.style.transform = 'rotate(0deg)';
                }
            } else if (visibleSlots.length === 0 && grp.dataset.alwaysShow !== 'true') {
                grp.style.display = 'none';
                g.style.display = 'none'; grp.classList.add('collapsed'); if (icon) icon.style.transform = 'rotate(-90deg)';
            }
            else {
                grp.style.display = 'block';
                if (visibleSlots.length > 0 && grp.dataset.alwaysOpen === 'true') {
                    grp.classList.remove('collapsed'); g.style.display = 'grid'; if (icon) icon.style.transform = 'rotate(0deg)';
                }
            }

            const badge = ctx.getEl(`grp-count-${g.id}`);
            if (!badge) return;
            const countBase = !targetHighlight && excludeGridIds.includes(g.id) ? slots : visibleSlots;
            const total = countBase.length;
            const done = countBase.filter(el => el.classList.contains('is-completed')).length;
            badge.textContent = total > 0 ? `${done} / ${total}` : '';
        });
    }

    function restoreChecklistGroupState(targetHighlight) {
        if (!targetHighlight && ctx._highlightGroupState) {
            ctx._highlightGroupState.forEach((state, groupId) => {
                const grp = ctx.getEl(groupId), grid = grp?.querySelector('.checklist-grid');
                if (!grp || !grid) return;
                grp.classList.toggle('collapsed', state.collapsed);
                grid.style.display = state.gridDisplay;
                const icon = grp.querySelector('.grp-toggle-icon');
                if (icon) icon.style.transform = state.collapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
            });
            ctx._highlightGroupState = null;
        }
    }

    /* ── 05 · 보드 갱신 ── */

    function updateChecklist(calcResult) {
        if (!ctx._isChecklistRendered) return;
        const board = ctx.getEl('checklistContent'), scrollTop = board?.scrollTop || 0;
        const { reqMap, baseMap, reasonMap } = calcResult || ctx.calculateBoardRequirements();
        const mergedSlots = new Set();

        const targetHighlight = ctx._currentHighlight || null;
        const highlightDeps = targetHighlight ? ctx.getDependencies(targetHighlight) : null;
        board?.classList.toggle('highlight-mode', !!targetHighlight);

        ctx.activeUnits.forEach((_, uid) => ctx.unitMap.get(uid)?.parsedRecipe?.forEach(pr => pr.id && ctx.activeUnits.has(pr.id) && mergedSlots.add(pr.id)));
        const directMaterials = new Set();
        ctx.activeUnits.forEach((_, uid) => { if (mergedSlots.has(uid)) return; ctx.unitMap.get(uid)?.parsedRecipe?.forEach(pr => pr.id && !ctx.activeUnits.has(pr.id) && directMaterials.add(pr.id)); });
        const excludeGridIds = (() => { try { return JSON.parse(ctx.getEl('checklistContent')?.dataset.excludeGridIds || '[]'); } catch { return []; } })();
        const pool = ctx.getEl('checklist-slot-pool');
        
        const grids = {
            target: ctx.getEl('grid-target'),
            special: ctx.getEl('grid-special'),
            upperHidden: ctx.getEl('grid-upper-hidden'),
            basicHidden: ctx.getEl('grid-basic-hidden')
        };
        const restoreLevelsByGridId = {
            'grid-basic-hidden': 2,
            'grid-upper-hidden': 3,
            'grid-special': 4,
            'grid-target': 5
        };
        ctx._unitRestoreLevels.clear();

        const exactDepths = getChecklistDepths(mergedSlots);

        const slotsByGrid = new Map(Object.values(grids).filter(Boolean).map(grid => [grid, []]));
        const usedSlots = new Set();
        const reasonEntriesCache = new Map();
        const getCachedReasonEntries = (slotId, rMap) => {
            if (!reasonEntriesCache.has(slotId)) reasonEntriesCache.set(slotId, getChecklistReasonDisplayEntries(slotId, rMap, reqMap));
            return reasonEntriesCache.get(slotId);
        };

        const visibleMaterialIds = new Set([...baseMap.keys(), ...reqMap.keys()]);
        const hiddenGroupMinGradeIndex = ctx.getGradeIndex(ctx.SYSTEM_CONFIG.policy.hiddenGroupMinGrade || '히든');

        const processSlot = (id) => {
            const slotEl = ctx._checklistSlotElsByUid.get(id); if (!slotEl) return null;
            
            if (ctx.AUTO_COST_SLOT_SET.has(id)) return null;

            const isTarget = ctx.activeUnits.has(id);
            const isCompletedTarget = !isTarget && ctx.completedTargets.has(id);
            const isMergedSlot = isTarget && mergedSlots.has(id);
            
            let needed = reqMap.get(id) || 0;
            if (isMergedSlot) needed = Math.max(0, (baseMap.get(id)||0) - (ctx.completedUnits.get(id)||0));
            else if (isTarget) needed = Math.max(0, (ctx.activeUnits.get(id)||1) - (ctx.completedUnits.get(id)||0));
            if (isCompletedTarget) needed = 0;
            
            const baseNeeded = isTarget ? (isMergedSlot ? (baseMap.get(id)||0) : (ctx.activeUnits.get(id)||1)) :
                             isCompletedTarget ? (ctx.completedTargets.get(id)||1) :
                             (baseMap.get(id)||0);

            if (!baseNeeded && !isTarget && !isCompletedTarget) return null;

            renderChecklistSlotReasons({
                id, slotEl, needed, isTarget, isMergedSlot, reasonMap,
                getCachedReasonEntries, targetHighlight, highlightDeps
            });

            const isCompleted = needed === 0;
            slotEl.classList.toggle('has-target', !isCompleted);
            slotEl.classList.toggle('is-completed', isCompleted);

            const uGrade = ctx.unitMap.get(id)?.grade;
            const isHiddenGroup = ctx.getGradeIndex(uGrade) >= hiddenGroupMinGradeIndex;
            const depthInTree = exactDepths.has(id) ? exactDepths.get(id) : 99;
            
            const nativeLevel = isHiddenGroup ? (depthInTree <= 2 ? 3 : 2) : 1;
            ctx._unitNativeLevels.set(id, nativeLevel);
            
            let upgradedGrid = null;
            
            if (isCompletedTarget) upgradedGrid = grids.target;
            else if (isMergedSlot) upgradedGrid = grids.special;
            else if (isTarget) upgradedGrid = grids.target;
            else if (directMaterials.has(id)) upgradedGrid = grids.special;
            else {
                const rVals = reasonMap.get(id);
                if (rVals) {
                    for (const i of rVals.values()) {
                        if (i.depth === 1) { upgradedGrid = grids.special; break; }
                    }
                }
            }
            
            let nativeGrid = null;
            if (isHiddenGroup) nativeGrid = grids.upperHidden;
            else if (isBasicChecklistGrade(uGrade)) nativeGrid = grids.basicHidden;
            const tGrid = upgradedGrid || nativeGrid;
            if (!tGrid) return null;

            const isFinalGoal = tGrid === grids.target;
            slotEl.classList.toggle('is-final-goal', isFinalGoal);
            slotEl.classList.toggle('is-direct-material', tGrid === grids.special);
            const readyLabel = slotEl.querySelector('.d-material-ready');
            const isMaterialReady = !isCompleted && ctx.getCompletedRecipeReadyQty(id, needed) >= 1;
            slotEl.classList.toggle('is-material-ready', isMaterialReady);
            if (readyLabel) readyLabel.hidden = !isMaterialReady;
            const targetButton = slotEl.querySelector('.d-target-badge');
            if (targetButton) {
                const canTrack = isFinalGoal || tGrid === grids.special;
                targetButton.hidden = !canTrack;
                if (canTrack) {
                    const isTracking = targetHighlight === id;
                    targetButton.classList.toggle('is-tracking', isTracking);
                    targetButton.setAttribute('aria-pressed', String(isTracking));
                    targetButton.textContent = isTracking ? '추적 해제' : '조합추적';
                }
            }
            if (isFinalGoal) renderChecklistRecipe(slotEl, calcResult);
            else switchChecklistDetail(id, slotEl.dataset.detailView, calcResult);
            const cWrap = slotEl.querySelector(`#craft-wrap-${id}`);
            if (cWrap) {
                if (!isCompleted) {
                    const oneDisabled = needed === 1 ? ' disabled' : '';
                    const tenDisabled = needed >= 10 ? '' : ' disabled';
                    const qtyButtons = isFinalGoal ? '' : `<button type="button" class="pc-btn" data-action="addComplete" data-uid="${id}" data-batch="1"${oneDisabled}><span class="batch-plus" aria-hidden="true">+</span>1개</button><button type="button" class="pc-btn" data-action="addComplete" data-uid="${id}" data-batch="10"${tenDisabled}><span class="batch-plus" aria-hidden="true">+</span>10개</button>`;
                    setHTMLIfChanged(cWrap, `<div class="craft-wrap-left"><span class="req-text">${needed}</span><span class="req-label">개</span></div><div class="craft-wrap-right">${qtyButtons}<button type="button" class="btn-complete" data-action="completeUnit" data-uid="${id}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m5 12 4 4 10-10"/></svg>완료</button></div>`);
                } else setHTMLIfChanged(cWrap, `<div class="craft-wrap-left"><span class="req-text">0</span><span class="req-label">개</span></div><div class="craft-wrap-right"><span class="complete-done-label">완료됨</span></div>`);
            }

            const gridId = tGrid?.id || '';
            ctx._unitRestoreLevels.set(id, restoreLevelsByGridId[gridId] || 0);
            const keepCompletedVisible = excludeGridIds.includes(gridId);
            const outsideTracking = !!targetHighlight && !highlightDeps?.has(id);
            const hideT = outsideTracking || (ctx._hideCompleted && isCompleted && !keepCompletedVisible);
            if (tGrid) {
                if (!hideT) {
                    slotEl.classList.add('is-visible');
                } else {
                    slotEl.classList.remove('is-visible');
                }
                const display = hideT ? 'none' : '';
                if (slotEl.style.display !== display) slotEl.style.display = display;
                slotsByGrid.get(tGrid).push(slotEl);
                usedSlots.add(slotEl);
            }

            return tGrid;
        };

        ctx.getUnitsFromIds(ctx.activeUnits.keys()).sort(ctx.compareUnitByChecklistPriority).forEach(u => processSlot(u.id));
        ctx.getUnitsFromIds(ctx.completedTargets.keys()).sort(ctx.compareUnitByGradeName).forEach(u => processSlot(u.id));

        ctx.getUnitsFromIds(Array.from(visibleMaterialIds)
            .filter(uid => !ctx.AUTO_COST_SLOT_SET.has(uid) && !ctx.activeUnits.has(uid) && !ctx.completedTargets.has(uid)))
            .sort(ctx.compareUnitByChecklistPriority)
            .forEach(u => processSlot(u.id));

        ctx._checklistSlotElsByUid.forEach(el => {
            if (usedSlots.has(el)) return;
            if (el.style.display !== 'none') el.style.display = 'none';
            el.classList.remove('is-visible', 'has-target', 'is-completed', 'is-direct-material', 'highlighted-tree', 'is-material-ready');
            const readyLabel = el.querySelector('.d-material-ready');
            if (readyLabel) readyLabel.hidden = true;
            if (pool && el.parentElement !== pool) pool.appendChild(el);
        });
        sortChecklistGrids(grids, slotsByGrid, !!targetHighlight);

        updateChecklistGroupVisibility(grids, targetHighlight, excludeGridIds);

        restoreChecklistGroupState(targetHighlight);
        placeChecklistControls();

        ctx._checklistSlotElsByUid.forEach((el, cleanId) => {
            el.classList.toggle('highlighted-tree', !!ctx._currentHighlight && highlightDeps?.has(cleanId));
        });
        updateGroupActionButtons();
        if (board && board.scrollTop !== scrollTop) board.scrollTop = scrollTop;
    }

    /* ── 06 · 완료 후보·처리·복구 ── */

    function getUnitCompletionState(uid, calcResult) {
        const { reqMap, baseMap, autoCostReq } = calcResult;
        const isTarget = ctx.activeUnits.has(uid);
        const isAutoCost = ctx.AUTO_COST_SLOT_SET.has(uid);
        let isMergedSlot = false;
        if (isTarget && !isAutoCost) {
            ctx.activeUnits.forEach((_, activeId) => {
                if (activeId !== uid && ctx.unitMap.get(activeId)?.parsedRecipe?.some(pr => pr.id === uid)) isMergedSlot = true;
            });
        }
        const isPureTarget = isTarget && !isMergedSlot && !isAutoCost;
        const remaining = isPureTarget
            ? Math.max(0, (ctx.activeUnits.get(uid) || 1) - (ctx.completedUnits.get(uid) || 0))
            : isAutoCost ? autoCostReq[uid] || 0
            : isTarget && isMergedSlot ? Math.max(0, (baseMap.get(uid) || 1) - (ctx.completedUnits.get(uid) || 0))
            : reqMap.get(uid) || 0;
        return { remaining, baseMap, isPureTarget, isTarget, isMergedSlot };
    }

    // 개별 완료와 일괄 완료가 같은 수량 소비·목표 이동 규칙을 사용합니다.
    function applyCompletedUnit(uid, amount, calcResult) {
        const { remaining, baseMap, isPureTarget, isTarget, isMergedSlot } = getUnitCompletionState(uid, calcResult);
        const requestedQty = amount === undefined ? remaining : parseInt(amount, 10);
        const processQty = requestedQty === 10 && remaining < 10 ? 0 : Math.min(requestedQty, remaining);
        if (!(processQty > 0)) return 0;

        const prevCompleted = ctx.completedUnits.get(uid) || 0;
        ctx.deleteCompletedRecipe(uid, processQty);
        const newComp = Math.max(prevCompleted, ctx.completedUnits.get(uid) || 0) + processQty;
        ctx.completedUnits.set(uid, newComp);

        if (isPureTarget && newComp >= (ctx.activeUnits.get(uid) || 1)) {
            ctx.completedTargets.set(uid, ctx.activeUnits.get(uid) || 1);
            ctx.activeUnits.delete(uid);
            ctx.completedUnits.delete(uid);
        } else if (isTarget && isMergedSlot) {
            const totalQty = baseMap.get(uid) || 1;
            if (newComp >= totalQty) {
                const activeQty = ctx.activeUnits.get(uid) || 1;
                const matQty = totalQty - activeQty;
                ctx.completedTargets.set(uid, activeQty);
                ctx.activeUnits.delete(uid);
                if (matQty > 0) ctx.completedUnits.set(uid, matQty);
                else ctx.completedUnits.delete(uid);
            }
        }
        return processQty;
    }

    function completeUnit(uid, amount) {
        if (ctx._completeLock.has(uid)) return;
        ctx._completeLock.add(uid);
        const cWrapEl = document.getElementById(`craft-wrap-${uid}`);
        const lockBtns = cWrapEl ? Array.from(cWrapEl.querySelectorAll('button')) : [];
        const enabledBtns = lockBtns.filter(b => !b.disabled);
        const restoreBtns = () => enabledBtns.forEach(b => { if (b.isConnected) b.disabled = false; });
        lockBtns.forEach(b => b.disabled = true);
        try {
            const processQty = applyCompletedUnit(uid, amount, ctx.calculateBoardRequirements());
            if (processQty > 0) ctx.commitNexusStateChange({ clearHighlight: true });
            else restoreBtns();
        } catch {
            restoreBtns();
        } finally {
            setTimeout(() => {
                ctx._completeLock.delete(uid);
                restoreBtns();
            }, ctx.APP_INTERNAL.completeLockDelay);
        }
    }

    // 해당 단계와 하위 단계만 선택합니다. 상위 유닛부터 처리하고 매 단계
    // 필요량을 재계산하여 재료 소비 후 아래 단계가 미완료로 남지 않게 합니다.
    function getGroupCompletionIds(level) {
        return [...ctx._unitRestoreLevels]
            .filter(([uid, groupLevel]) => groupLevel > 0 && groupLevel <= level && ctx.unitMap.has(uid))
            .map(([uid]) => uid)
            .sort((a, b) => {
                const diff = (ctx._unitRestoreLevels.get(b) || 0) - (ctx._unitRestoreLevels.get(a) || 0);
                if (diff) return diff;
                if (ctx.getDependencies(a).has(b)) return -1;
                if (ctx.getDependencies(b).has(a)) return 1;
                return ctx.compareUnitByChecklistPriority(ctx.unitMap.get(a), ctx.unitMap.get(b));
            });
    }

    const getGroupCompleteLabel = (level) =>
        ctx.GROUP_DEFS.find(g => g.resetLevel === level)?.resetLabel.replace(/복구$/, '완료') || '일괄 완료';

    let pendingGroupComplete = null;
    function clearGroupCompleteConfirmation() {
        if (!pendingGroupComplete) return;
        clearTimeout(pendingGroupComplete.timer);
        const btn = document.querySelector(`.grp-title-actions [data-action="completeGroup"][data-level="${pendingGroupComplete.level}"]`);
        btn?.classList.remove('group-complete-pending');
        if (btn) {
            const label = getGroupCompleteLabel(pendingGroupComplete.level);
            const text = btn.querySelector('.group-complete-label');
            if (text && label) text.textContent = label;
            btn.title = getGroupCompleteDescription(pendingGroupComplete.level);
        }
        pendingGroupComplete = null;
    }

    function completeGroup(level) {
        const btn = document.querySelector(`.grp-title-actions [data-action="completeGroup"][data-level="${level}"]`);
        if (!btn || btn.disabled) return;
        const signature = JSON.stringify([[...ctx.activeUnits], [...ctx.completedUnits], [...ctx.completedTargets]]);
        if (!pendingGroupComplete || pendingGroupComplete.level !== level || pendingGroupComplete.signature !== signature) {
            clearGroupCompleteConfirmation();
            const label = btn.querySelector('.group-complete-label');
            if (label) label.textContent = '완료 확인';
            btn.classList.add('group-complete-pending');
            btn.title = '한 번 더 누르면 해당 단계와 모든 하위 재료를 일괄 완료합니다 (4초 내)';
            pendingGroupComplete = { level, signature, timer: setTimeout(clearGroupCompleteConfirmation, 4000) };
            return;
        }
        clearGroupCompleteConfirmation();
        let count = 0;
        for (const uid of getGroupCompletionIds(level)) {
            if (applyCompletedUnit(uid, undefined, ctx.calculateBoardRequirements()) > 0) count++;
        }
        if (count > 0) {
            const label = getGroupCompleteLabel(level);
            ctx.showActionFeedback(`${label} · ${count}종 완료됨 ✓`);
            ctx.commitNexusStateChange({ clearHighlight: true });
        }
    }

    function resetGroupCompleted(level) {
        clearGroupCompleteConfirmation();
        const ids = ctx.getGroupRestoreIds(level);
        if (ids.size === 0) return;
        if (level >= 5) {
            const targetEntries = Array.from(ctx.completedTargets.entries());
            ctx.completedTargets.clear();
            targetEntries.forEach(([uid, qty]) => {
                ctx.setActiveUnitQty(uid, (ctx.activeUnits.get(uid) || 0) + qty);
            });
            ctx.completedUnits.clear();
            ctx._selectionResetRetainedCompleted.clear();
            ctx._presetUsed.clear(); ctx.updatePresetBtns();
        } else {
            ctx.resetCompletedMaterialsByLevel(level);
        }
        const label = ctx.GROUP_DEFS.find(group => group.resetLevel === level)?.resetLabel || '완료 복구';
        ctx.showActionFeedback(`${label} · ${ids.size}종 복구됨 ✓`);
        ctx.commitNexusStateChange({ clearHighlight: true });
    }

    function getGroupRestoreDescription(level) {
        if (level >= 5) return '완료된 목표를 선택 목록으로 돌리고, 모든 재료의 완료 상태를 초기화합니다. 보류 목록은 유지합니다.';
        if (level >= 4) return '직속·히든·기본 재료의 완료 상태를 함께 복구합니다. 목표와 보류 목록은 유지합니다.';
        if (level >= 3) return '히든·기본 재료의 완료 상태를 함께 복구합니다. 목표와 보류 목록은 유지합니다.';
        return '기본 재료의 완료 상태만 복구합니다. 목표와 보류 목록은 유지합니다.';
    }

    function getGroupCompleteDescription(level) {
        if (level >= 5) return '최종 목표와 직속·히든·기본 재료를 일괄 완료합니다. 확인을 위해 두 번 누릅니다.';
        if (level >= 4) return '직속·히든·기본 재료를 일괄 완료합니다. 직속 재료를 겸하는 선택 목표도 포함됩니다. 확인을 위해 두 번 누릅니다.';
        if (level >= 3) return '히든·기본 재료를 일괄 완료합니다. 최종·직속 재료는 유지합니다. 확인을 위해 두 번 누릅니다.';
        return '기본 재료만 일괄 완료합니다. 상위 조합은 유지합니다. 확인을 위해 두 번 누릅니다.';
    }

    function updateGroupActionButtons() {
        const calcResult = ctx.calculateBoardRequirements();
        const outstanding = [...ctx._unitRestoreLevels].filter(([uid, groupLevel]) =>
            groupLevel > 0 && ctx.unitMap.has(uid) && getUnitCompletionState(uid, calcResult).remaining > 0
        ).map(([, groupLevel]) => groupLevel);
        document.querySelectorAll('.grp-title-actions [data-level]').forEach(btn => {
            const level = parseInt(btn.dataset.level, 10);
            if (btn.dataset.action === 'resetGroup') {
                const count = ctx.getGroupRestoreIds(level).size;
                btn.disabled = count === 0;
                btn.title = `${getGroupRestoreDescription(level)} · ${count > 0 ? `복구 대상 ${count}종` : '복구할 항목 없음'}`;
            } else if (btn.dataset.action === 'completeGroup') {
                const count = outstanding.filter(groupLevel => groupLevel <= level).length;
                btn.disabled = count === 0;
                if (!pendingGroupComplete || pendingGroupComplete.level !== level) {
                    btn.title = `${getGroupCompleteDescription(level)} · ${count > 0 ? `완료 대상 ${count}종` : '완료할 항목 없음'}`;
                }
            }
        });
    }

    /* ── 공개 API ── */

    return { completeGroup, completeUnit, placeChecklistControls, renderChecklist, resetGroupCompleted, returnChecklistControlsToHeader, switchChecklistDetail, updateChecklist };

};
