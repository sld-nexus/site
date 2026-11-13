/* 기능 모듈 — V39 공통 상태·계산·저장은 app.js 단일 원본을 사용합니다. */
window.NEXUS_HIDDEN = function createHiddenboard(ctx) {
    'use strict';
    function getGroupRestoreDescription(level) {
        if (level >= 5) return '완료된 목표를 선택 목록으로 돌리고, 모든 재료의 완료·보유량을 초기화합니다. 보류 목록은 유지합니다.';
        if (level >= 4) return '직속·히든·기본 재료의 완료 상태를 함께 복구합니다. 목표와 보류 목록은 유지합니다.';
        if (level >= 3) return '히든·기본 재료의 완료 상태를 함께 복구합니다. 목표와 보류 목록은 유지합니다.';
        return '기본 재료의 완료 상태만 복구합니다. 목표와 보류 목록은 유지합니다.';
    }

    function updateGroupRestoreButtons() {
        document.querySelectorAll('.grp-title-actions [data-action="resetGroup"]').forEach(btn => {
            const level = parseInt(btn.dataset.level, 10), count = ctx.getGroupRestoreIds(level).size;
            const description = getGroupRestoreDescription(level);
            btn.disabled = count === 0;
            btn.title = `${description} · ${count > 0 ? `복구 대상 ${count}종` : '복구할 항목 없음'}`;
        });
    }

    function completeUnit(uid, amount) {
        if (ctx._completeLock.has(uid)) return;
        ctx._completeLock.add(uid);
        const cWrapEl = document.getElementById(`craft-wrap-${uid}`);
        const lockBtns = cWrapEl ? Array.from(cWrapEl.querySelectorAll('button')) : [];
        lockBtns.forEach(b => b.disabled = true);
        try {
            const { reqMap, baseMap, autoCostReq } = ctx.calculateBoardRequirements();
            const isTarget = ctx.activeUnits.has(uid);
            const isAutoCost = ctx.AUTO_COST_SLOT_SET.has(uid);
            let isMergedSlot = false;
            if (isTarget && !isAutoCost) {
                ctx.activeUnits.forEach((_, activeId) => {
                    if (activeId !== uid && ctx.unitMap.get(activeId)?.parsedRecipe?.some(pr => pr.id === uid)) isMergedSlot = true;
                });
            }
            const isPureTarget = isTarget && !isMergedSlot && !isAutoCost;
            let reqVal = 0;
            if (isPureTarget) reqVal = Math.max(0, (ctx.activeUnits.get(uid) || 1) - (ctx.completedUnits.get(uid) || 0));
            else if (isAutoCost) reqVal = autoCostReq[uid] || 0;
            else if (isTarget && isMergedSlot) reqVal = Math.max(0, (baseMap.get(uid) || 1) - (ctx.completedUnits.get(uid) || 0));
            else reqVal = reqMap.get(uid) || 0;

            const requestedQty = amount !== undefined ? parseInt(amount, 10) : reqVal;
            const processQty = requestedQty === 10 && reqVal < 10 ? 0 : Math.min(requestedQty, reqVal);
            if (processQty > 0) {
                const prevCompleted = ctx.completedUnits.get(uid) || 0;
                ctx.deleteCompletedRecipe(uid, processQty);
                const newComp = Math.max(prevCompleted, ctx.completedUnits.get(uid) || 0) + processQty;
                ctx.completedUnits.set(uid, newComp);

                if (isPureTarget) {
                    if (newComp >= (ctx.activeUnits.get(uid) || 1)) {
                        ctx.completedTargets.set(uid, ctx.activeUnits.get(uid) || 1);
                        ctx.activeUnits.delete(uid);
                        ctx.completedUnits.delete(uid);
                    }
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
                completeHiddenboardRecipeUnitsIfReady();
                ctx.commitNexusStateChange({ clearHighlight: true });
            } else {
                lockBtns.forEach(b => b.disabled = false);
            }
        } catch {
            lockBtns.forEach(b => b.disabled = false);
        } finally {
            setTimeout(() => { ctx._completeLock.delete(uid); }, ctx.APP_INTERNAL.completeLockDelay);
        }
    }

    function resetGroupCompleted(level) {
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
            ctx._invenboardAutoCompletedUnits.clear();
            ctx._invenboardManualInputs.clear();
            ctx._presetUsed.clear(); ctx.updatePresetBtns();
        } else {
            ctx.resetCompletedMaterialsByLevel(level);
        }
        const label = ctx.GROUP_DEFS.find(group => group.resetLevel === level)?.resetLabel || '완료 복구';
        ctx.showActionFeedback(`${label} · ${ids.size}종 복구됨 ✓`);
        ctx.commitNexusStateChange({ clearHighlight: true });
    }




    /* 히든보드 */
    const BASIC_HIDDENBOARD_GRADES = new Set(["레어", "에픽", "유니크", "헬", "레전드"]);
    const isBasicHiddenboardGrade = (grade) => BASIC_HIDDENBOARD_GRADES.has(grade);

    function renderHiddenboard() {
        if (ctx._isHiddenboardRendered) return;
        const boardEl = ctx.getEl('boardContent');
        if (!boardEl) return;
        boardEl.classList.remove('invenboard-mode');
        ctx._isInvenboardRendered = false;

        const renderHiddenboardSlot = (id, n, g) => {
            const unit = ctx.unitMap.get(id);
            const essenceText = ctx.getUnitUnitboardEssenceText(unit) || `<div class="uc-essence-summary" aria-label="${ctx.escapeHtml(n)} 정수정보"><span class="uc-essence-empty">정수 <span class="uc-essence-value">0</span></span></div>`;
            const noticeHtml = ctx.getUnitCardNotesHtml(unit);
            return `<div class="hiddenboard-slot" id="d-slot-wrap-${id}" data-uid="${id}" data-detail-view="usage"><div class="d-slot-main"><div class="d-name"><div class="d-grade-row"><div class="d-grade-left"><span class="gtag grade-${g}">${g}</span></div><div class="d-card-actions"><span class="d-target-control"><button type="button" class="d-info-button" data-hiddenboard-info="${id}" data-info-view="usage" aria-label="${n} 상위 조합 추적" aria-haspopup="dialog" aria-expanded="false" title="상위 조합 추적 · 사용처"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22"/></svg></button><span class="d-tracking-bubble" id="tracking-hint-${id}" role="tooltip" hidden><kbd>ESC</kbd> 또는 빈 공간 클릭 시 추적 해제</span></span><button type="button" class="d-info-button" data-hiddenboard-info="${id}" data-info-view="recipe" aria-label="${n} 조합법 정보" aria-haspopup="dialog" aria-expanded="false" title="조합법 정보"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v6M12 7v.2"/></svg></button></div></div><div class="d-name-line"><span class="d-name-inline">${n}${ctx.CLEAN_SPECIAL_CONDITIONS[id]?`<span class="badge-special-cond recipe-cond-offset">특수조건</span>`:''}</span></div>${noticeHtml}${essenceText}</div></div><div id="d-cond-${id}" class="d-cond-inline"></div><div class="d-detail-wrap"><div class="d-detail-toolbar"><div class="d-detail-tabs" role="group" aria-label="${n} 표시 정보"><button type="button" class="d-detail-tab is-active" data-action="switchHiddenboardDetail" data-uid="${id}" data-detail-view="usage" aria-pressed="true" aria-controls="d-reason-${id}">사용처</button><button type="button" class="d-detail-tab" data-action="switchHiddenboardDetail" data-uid="${id}" data-detail-view="recipe" aria-pressed="false" aria-controls="d-recipe-${id}">조합법</button></div><span class="d-detail-meta d-usage-hint" title="사용처 유닛을 클릭하면 목표를 추적합니다">목표추적 ↗</span><span class="d-detail-meta d-recipe-meta"></span></div><div class="d-detail-panels"><div class="d-reason-wrap" id="d-reason-${id}" aria-hidden="false"></div><div class="d-recipe-wrap" id="d-recipe-${id}" aria-hidden="true" inert></div></div></div><div class="d-goal-recipe-wrap" id="d-goal-recipe-${id}"></div><div id="craft-wrap-${id}" class="craft-wrap"></div></div>`;
        };
        const getGrp = (id, pid, title, resetLevel=0, isCol=false, alwaysShow=false, alwaysOpen=false, resetLabel='완료복구') => `
            <div class="hiddenboard-group" id="${id}" style="${alwaysShow ? '' : 'display:none;'}" ${alwaysShow ? 'data-always-show="true"' : ''} ${alwaysOpen ? 'data-always-open="true"' : ''}>
                <div class="hiddenboard-group-title" data-action="toggleGroup" data-grid-id="${pid}">
                    <div class="grp-title-main">
                        <span class="grp-toggle-icon" style="transform:${isCol?'rotate(-90deg)':'rotate(0deg)'};">▼</span>
                        <span>${title}</span>
                        ${resetLevel > 0 ? `<span class="grp-count-badge" id="grp-count-${pid}"></span>` : ''}
                    </div>
                    <div class="grp-title-actions" id="${id}-actions">
                        ${resetLevel > 0 ? `<button type="button" class="btn-text-link" data-action="resetGroup" data-level="${resetLevel}" title="${getGroupRestoreDescription(resetLevel)}" disabled><span>${resetLabel}</span><span class="action-icon" aria-hidden="true">↺</span></button>` : ''}
                    </div>
                </div>
                <div class="hiddenboard-grid" id="${pid}" ${isCol?'style="display:none;"':''}></div>
            </div>`;

        const allUnits = Array.from(ctx.unitMap.values());
        const unitSlots = allUnits.filter(u => ctx.getGradeIndex(u.grade) >= ctx.getGradeIndex(ctx.SYSTEM_CONFIG.policy.minGradeForHiddenboard) && !ctx.AUTO_COST_SLOT_SET.has(u.id)).map(u => renderHiddenboardSlot(u.id, u.name, u.grade)).join('');

        const _exIds = new Set((ctx.SYSTEM_CONFIG.policy.hideCompletedExcludeGroups || []).map(t => ctx.titleToGridId[t]).filter(Boolean));

        returnHiddenboardControlsToHeader();
        boardEl.innerHTML = `<div id="hiddenboard-empty-msg" class="empty-msg"></div><div id="hiddenboard-slot-pool" class="hiddenboard-slot-pool">${unitSlots}</div>` + ctx.GROUP_DEFS.map(g => getGrp(g.id, g.pid, g.title, g.resetLevel, g.isCol, g.alwaysShow, g.alwaysOpen, g.resetLabel)).join('');
        boardEl.dataset.excludeGridIds = JSON.stringify([..._exIds]);
        ctx._hiddenboardSlotElsByUid.clear();
        boardEl.querySelectorAll('.hiddenboard-slot[data-uid]').forEach(el => ctx._hiddenboardSlotElsByUid.set(el.dataset.uid, el));
        ctx._isHiddenboardRendered = true;
        placeHiddenboardControls();
    }

    // 카드 밖에 하나의 팝오버를 띄워 카드 높이와 그리드 정렬을 유지합니다.
    let detailPopover = null;
    let detailTrigger = null;
    let detailAnchor = null;
    let detailView = 'usage';
    let trackingOriginId = null;

    function closeDetailPopover(restoreFocus = false) {
        if (!detailPopover) return;
        detailPopover.remove();
        detailPopover = null;
        detailTrigger?.setAttribute('aria-expanded', 'false');
        if (restoreFocus && detailTrigger?.isConnected) detailTrigger.focus({ preventScroll: true });
        detailTrigger = null;
    }

    function positionDetailPopover() {
        if (!detailPopover || !detailAnchor) return;
        const viewport = window.visualViewport;
        const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
        const width = viewport?.width || window.innerWidth;
        const height = viewport?.height || window.innerHeight;
        const edge = 12, gap = 10;
        detailPopover.style.maxHeight = `${Math.max(80, height - edge * 2)}px`;
        detailPopover.style.width = `${Math.min(340, width - edge * 2)}px`;
        const rect = detailPopover.getBoundingClientRect();
        let x = detailAnchor.x - rect.width, y = detailAnchor.y + gap;
        if (x + rect.width > left + width - edge) x = detailAnchor.x - rect.width;
        if (y + rect.height > top + height - edge) y = detailAnchor.top - rect.height - gap;
        detailPopover.style.left = `${Math.max(left + edge, Math.min(x, left + width - rect.width - edge))}px`;
        detailPopover.style.top = `${Math.max(top + edge, Math.min(y, top + height - rect.height - edge))}px`;
    }

    function getUsageTrackingTargets(id) {
        return [...ctx._hiddenboardSlotElsByUid.values()]
            .filter(slot => slot.classList.contains('is-final-goal') && ctx.activeUnits.has(slot.dataset.uid) && ctx.getDependencies(slot.dataset.uid).has(id))
            .map(slot => {
                const uid = slot.dataset.uid;
                return { unit: ctx.unitMap.get(uid), qty: ctx.activeUnits.get(uid) || 1 };
            }).filter(target => target.unit);
    }

    function renderDetailPopover() {
        if (!detailPopover || !detailTrigger) return;
        const id = detailTrigger.dataset.hiddenboardInfo;
        const unit = ctx.unitMap.get(id);
        const slot = ctx._hiddenboardSlotElsByUid.get(id);
        if (!unit || !slot) return closeDetailPopover();
        const { multi, countLabel } = getHiddenboardRecipeQuantity(id);
        const targets = getUsageTrackingTargets(id);
        const goalCount = targets.reduce((sum, target) => sum + target.qty, 0);
        const reasons = targets.map(({ unit: goal, qty }) => `<button type="button" class="d-reason-tag is-split-reason tag-grade-${goal.grade}" data-action="toggleHighlight" data-uid="${goal.id}"><span class="d-reason-grade">${ctx.escapeHtml(goal.grade)}</span><span class="d-reason-main">${ctx.escapeHtml(goal.name)}</span><span class="d-reason-qty">×${qty}</span></button>`).join('');
        const meta = detailView === 'usage' ? `최종목표 ${goalCount}기 · 추적할 목표를 선택하세요.` : countLabel;
        detailPopover.innerHTML = `<div class="hb-popover-heading"><div class="hb-popover-title-group"><strong id="hb-popover-title">${detailView === 'usage' ? '사용처' : '조합법'}</strong><span class="hb-popover-unit">${ctx.escapeHtml(unit.name)}</span></div><button type="button" class="hb-popover-close" aria-label="정보 닫기">×</button></div>${meta ? `<div class="hb-popover-hint">${ctx.escapeHtml(meta)}</div>` : ''}<div class="hb-popover-content">${detailView === 'usage' ? (reasons || '<p class="hb-popover-empty">연결된 최종목표 없음</p>') : `<span class="recipe-label">조합 조건</span>${ctx.formatRecipe(unit, multi, true)}`}</div><div class="hb-popover-footer"><kbd>ESC</kbd><span>또는 빈 공간 클릭 시 닫힘</span></div>`;
        positionDetailPopover();
    }

    document.addEventListener('click', event => {
        const trigger = event.target.closest('[data-hiddenboard-info]');
        if (trigger) {
            event.preventDefault();
            event.stopPropagation();
            const slot = ctx._hiddenboardSlotElsByUid.get(trigger.dataset.hiddenboardInfo);
            if (trigger.dataset.infoView === 'usage' && (slot?.classList.contains('is-final-goal') || (ctx._currentHighlight && trackingOriginId === trigger.dataset.hiddenboardInfo))) {
                closeDetailPopover();
                const stopTracking = ctx._currentHighlight && trackingOriginId === trigger.dataset.hiddenboardInfo;
                trackingOriginId = trigger.dataset.hiddenboardInfo;
                ctx.toggleHighlight(stopTracking ? null : trigger.dataset.hiddenboardInfo, event);
                return;
            }
            if (trigger.dataset.infoView === 'usage') {
                const targets = getUsageTrackingTargets(trigger.dataset.hiddenboardInfo);
                if (targets.length === 1) {
                    closeDetailPopover();
                    trackingOriginId = trigger.dataset.hiddenboardInfo;
                    ctx.toggleHighlight(targets[0].unit.id, event);
                    return;
                }
            }
            if (trigger === detailTrigger) return closeDetailPopover();
            closeDetailPopover();
            detailTrigger = trigger;
            detailView = trigger.dataset.infoView === 'recipe' ? 'recipe' : 'usage';
            const rect = trigger.getBoundingClientRect();
            detailAnchor = { x: rect.right, y: rect.bottom, top: rect.top };
            detailPopover = document.createElement('section');
            detailPopover.className = 'hb-detail-popover';
            detailPopover.id = 'hb-detail-popover';
            detailPopover.setAttribute('role', 'dialog');
            detailPopover.setAttribute('aria-labelledby', 'hb-popover-title');
            document.body.appendChild(detailPopover);
            trigger.setAttribute('aria-expanded', 'true');
            trigger.setAttribute('aria-controls', 'hb-detail-popover');
            renderDetailPopover();
            if (event.detail === 0) detailPopover.querySelector('.hb-popover-close').focus({ preventScroll: true });
            return;
        }
        if (event.target.closest('.hb-popover-close')) {
            event.stopPropagation();
            return closeDetailPopover(true);
        }
        const usageTarget = event.target.closest('[data-action="toggleHighlight"]');
        if (usageTarget && detailPopover?.contains(usageTarget)) {
            trackingOriginId = detailTrigger?.dataset.hiddenboardInfo || usageTarget.dataset.uid;
            ctx.toggleHighlight(usageTarget.dataset.uid, event);
            closeDetailPopover();
            return;
        }
        if (detailPopover && !detailPopover.contains(event.target)) closeDetailPopover();
    }, true);
    document.addEventListener('pointerdown', event => {
        if (detailPopover && !detailPopover.contains(event.target) && !event.target.closest('[data-hiddenboard-info]')) closeDetailPopover();
    }, true);
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && detailPopover) { event.preventDefault(); closeDetailPopover(true); }
    });
    document.addEventListener('focusin', event => {
        if (detailPopover && !detailPopover.contains(event.target) && event.target !== detailTrigger && !event.target.closest('[data-hiddenboard-info]')) closeDetailPopover();
    });
    document.addEventListener('scroll', event => {
        if (detailPopover && event.target !== detailPopover && !detailPopover.contains(event.target)) closeDetailPopover();
    }, true);
    window.addEventListener('resize', () => closeDetailPopover());

    function getHiddenboardRecipeQuantity(id, calcResult) {
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

    function renderHiddenboardRecipe(slotEl, calcResult) {
        const id = slotEl.dataset.uid;
        const unit = ctx.unitMap.get(id);
        if (!unit) return;
        const isGoal = slotEl.classList.contains('is-final-goal');
        const recipeEl = slotEl.querySelector(isGoal ? '.d-goal-recipe-wrap' : '.d-recipe-wrap');
        if (!recipeEl) return;
        const { multi, countLabel } = getHiddenboardRecipeQuantity(id, calcResult);
        const renderKey = `${multi}:${countLabel}`;
        if (recipeEl._renderKey === renderKey) return;
        if (isGoal) {
            recipeEl.innerHTML = `<div class="uc-recipe-area"><span class="recipe-label">조합 조건<span class="d-recipe-count">${ctx.escapeHtml(countLabel)}</span></span>${ctx.formatRecipe(unit, multi)}</div>`;
        } else {
            slotEl.querySelector(".d-recipe-meta").textContent = countLabel;
            recipeEl.innerHTML = `<div class="d-recipe-content">${ctx.formatRecipe(unit, multi, true)}</div>`;
        }
        recipeEl._renderKey = renderKey;
    }

    function switchHiddenboardDetail(id, view, calcResult = null) {
        const slotEl = ctx._hiddenboardSlotElsByUid.get(id);
        if (!slotEl || slotEl.classList.contains('is-final-goal')) return;
        const activeView = view === 'recipe' ? 'recipe' : 'usage';
        slotEl.dataset.detailView = activeView;
        slotEl.querySelectorAll('.d-detail-tab').forEach(tab => {
            const selected = tab.dataset.detailView === activeView;
            tab.classList.toggle('is-active', selected);
            tab.setAttribute('aria-pressed', String(selected));
        });
        // 두 패널의 높이를 함께 확보하여 탭 전환에도 카드와 하단 버튼 정렬을 유지합니다.
        // 클릭할 수 있는 사용처 태그는 선택된 탭에서만 활성화합니다.
        for (const [panel, selected] of [
            [slotEl.querySelector('.d-reason-wrap'), activeView === 'usage'],
            [slotEl.querySelector('.d-recipe-wrap'), activeView === 'recipe']
        ]) {
            if (!panel) continue;
            panel.setAttribute('aria-hidden', String(!selected));
            panel.inert = !selected;
        }
        renderHiddenboardRecipe(slotEl, calcResult);
    }

    function returnHiddenboardControlsToHeader() {
        const actions = ctx.getEl('hiddenboardGlobalActions') || document.querySelector('.hiddenboard-ph-btns');
        const mobileHost = ctx.getEl('boardMobileHeader');
        if (!actions || !mobileHost) return;
        if (actions.parentElement !== mobileHost) mobileHost.appendChild(actions);
        actions.classList.remove('hiddenboard-actions-in-group');
        actions.classList.add('hiddenboard-actions-in-header');
    }

    function placeHiddenboardControls() {
        const actions = ctx.getEl('hiddenboardGlobalActions') || document.querySelector('.hiddenboard-ph-btns');
        const mobileHost = ctx.getEl('boardMobileHeader');
        const desktopHost = ctx.getEl('group-target-actions');
        if (!actions || !mobileHost) return;
        const useMobileHeader = window.matchMedia('(max-width: 767px)').matches || !desktopHost;
        if (useMobileHeader) {
            if (actions.parentElement !== mobileHost) mobileHost.appendChild(actions);
            actions.classList.remove('hiddenboard-actions-in-group');
            actions.classList.add('hiddenboard-actions-in-header');
        } else {
            if (actions.parentElement !== desktopHost) desktopHost.insertBefore(actions, desktopHost.firstChild);
            actions.classList.remove('hiddenboard-actions-in-header');
            actions.classList.add('hiddenboard-actions-in-group');
        }
    }

    function wrapHiddenboardGridPages(grid, pageSize, onlyVisible = false) {
        if (!grid) return;
        const items = Array.from(grid.children).filter(el =>
            el.classList.contains('hiddenboard-slot') && (!onlyVisible || el.style.display !== 'none')
        );
        if (items.length === 0) return;
        const size = Math.max(1, pageSize || items.length);
        const frag = document.createDocumentFragment();
        for (let i = 0; i < items.length; i += size) {
            const page = document.createElement('div');
            page.className = 'hiddenboard-page';
            items.slice(i, i + size).forEach(el => page.appendChild(el));
            frag.appendChild(page);
        }
        grid.appendChild(frag);
    }

    // 조합 진행도 차감을 적용한 사용처 수량: 화면 표시 전용 계산.
    function getHiddenboardReasonDisplayEntries(slotId, rMap, reqMap) {
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
        const entries = [...rMap.entries()].map(([rId, info], index) => ({
            rId,
            info,
            index,
            baseQty: getReasonBaseQty(rId, info),
            displayQty: info?.depth === 0 ? 0 : getReasonBaseQty(rId, info)
        }));
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

    // 카드 사용처·조합 조건 표시는 재료 배치/완료 상태 변경과 분리한다.
    function renderHiddenboardSlotReasons({ id, slotEl, needed, isTarget, isMergedSlot, reasonMap, getCachedReasonEntries, targetHighlight, highlightDeps }) {
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
                    if (filtered.length > 0) allEntries = filtered;
                }
                if (allEntries.length > 0) {
                    const sorted = allEntries.sort((a, b) =>
                        (a[1].depth || 0) - (b[1].depth || 0) ||
                        (a[1].reasonGradeRank ?? ctx.REASON_GRADE_ORDER.length) - (b[1].reasonGradeRank ?? ctx.REASON_GRADE_ORDER.length) ||
                        (a[1]._reasonOrder || 0) - (b[1]._reasonOrder || 0)
                    );
                    rCon.classList.toggle('is-target-only', sorted.every(([, info]) => info.depth === 0));
                    rCon.innerHTML = sorted.map(([rId, info]) => {
                        const splitTagClass = isSplitReason(info) ? ' is-split-reason' : '';
                        return `<button type="button" class="d-reason-tag ${getReasonTagClass(info)}${splitTagClass}" data-action="toggleHighlight" data-uid="${rId.replace(/^(TARGET_|MAT_|TOOL_|AUTO_)/,'')}">${renderReasonTagContent(info)}</button>`;
                    }).join('');
                } else {
                    rCon.classList.remove('is-target-only');
                    rCon.innerHTML = '';
                }
            } else {
                rCon.classList.remove('is-target-only');
                rCon.innerHTML = '';
            }
        }

        const cEl = slotEl.querySelector(`#d-cond-${id}`);
        if (cEl) {
            let rMap = reasonMap.get(id);
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
                const finalGoalCount = getUsageTrackingTargets(id).length;
                cEl.innerHTML = `<span class="recipe-label">조합 조건<span class="d-condition-goal-count">· 최종목표 ${finalGoalCount}개</span></span>` + Array.from(condMap, ([condStr, qty]) => `<div class="d-condition-row"><span class="d-cond-text">${ctx.escapeHtml(condStr)}</span><span class="d-cond-qty">${qty}개</span></div>`).join('');
            } else {
                cEl.style.display = 'none';
                cEl.innerHTML = '';
            }
        }
    }

    // 루트 목표로부터의 조합 깊이는 히든보드 배치에만 사용한다.
    function getHiddenboardDepths(mergedSlots) {
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

    function sortHiddenboardGrids(grids) {
        [grids.target, grids.special, grids.upperHidden, grids.basicHidden].forEach(grid => {
            if (!grid) return;
            const children = Array.from(grid.children);
            children.sort((a, b) => {
                const uidA = a.dataset.uid || a.id.replace('d-slot-wrap-','');
                const uidB = b.dataset.uid || b.id.replace('d-slot-wrap-','');
                const uA = ctx.unitMap.get(uidA);
                const uB = ctx.unitMap.get(uidB);
                if (grid === grids.upperHidden) {
                    const levelDiff = (ctx._unitNativeLevels.get(uidB) || 1) - (ctx._unitNativeLevels.get(uidA) || 1);
                    if (levelDiff !== 0) return levelDiff;
                }
                return ctx.getGradeIndex(uB?.grade) - ctx.getGradeIndex(uA?.grade) ||
                       (ctx.SYSTEM_CONFIG.sorting.order[uB?.name]||0) - (ctx.SYSTEM_CONFIG.sorting.order[uA?.name]||0) ||
                       (uA?.name || uidA).localeCompare(uB?.name || uidB);
            });
            children.forEach(el => grid.appendChild(el));
        });
    }

    function updateHiddenboardGroupVisibility(grids, targetHighlight, excludeGridIds) {
        Object.values(grids).forEach(g => {
            if (!g) return;
            const grp = g.closest('.hiddenboard-group'), icon = grp?.querySelector('.grp-toggle-icon');
            if (!grp) return;
            
            const slots = Array.from(g.querySelectorAll('.hiddenboard-slot'));
            const visibleSlots = slots.filter(el => el.style.display !== 'none');

            if (targetHighlight) {
                grp.style.display = visibleSlots.length > 0 ? 'block' : 'none';
                if (visibleSlots.length > 0) {
                    grp.classList.remove('collapsed');
                    g.style.display = 'grid';
                    if (icon) icon.style.transform = 'rotate(0deg)';
                }
            } else if (visibleSlots.length === 0 && grp.dataset.alwaysShow !== 'true') {
                grp.style.display = 'block';
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

    function restoreHiddenboardGroupState(targetHighlight) {
        if (!targetHighlight && ctx._highlightGroupState) {
            ctx._highlightGroupState.forEach((state, groupId) => {
                const grp = ctx.getEl(groupId), grid = grp?.querySelector('.hiddenboard-grid');
                if (!grp || !grid) return;
                grp.classList.toggle('collapsed', state.collapsed);
                grid.style.display = state.gridDisplay;
                const icon = grp.querySelector('.grp-toggle-icon');
                if (icon) icon.style.transform = state.collapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
            });
            ctx._highlightGroupState = null;
        }
    }

    function updateHiddenboard(calcResult) {
        if (!ctx._isHiddenboardRendered) return;
        const { reqMap, baseMap, reasonMap } = calcResult || ctx.calculateBoardRequirements();
        const mergedSlots = new Set();

        const targetHighlight = ctx._currentHighlight || null;
        if (!targetHighlight) trackingOriginId = null;
        else if (!trackingOriginId) trackingOriginId = targetHighlight;
        const highlightDeps = targetHighlight ? ctx.getDependencies(targetHighlight) : null;
        ctx.getEl('boardContent')?.classList.toggle('highlight-mode', !!targetHighlight);

        ctx.activeUnits.forEach((_, uid) => ctx.unitMap.get(uid)?.parsedRecipe?.forEach(pr => pr.id && ctx.activeUnits.has(pr.id) && mergedSlots.add(pr.id)));
        const directMaterials = new Set();
        ctx.activeUnits.forEach((_, uid) => { if (mergedSlots.has(uid)) return; ctx.unitMap.get(uid)?.parsedRecipe?.forEach(pr => pr.id && !ctx.activeUnits.has(pr.id) && directMaterials.add(pr.id)); });
        const excludeGridIds = (() => { try { return JSON.parse(ctx.getEl('boardContent')?.dataset.excludeGridIds || '[]'); } catch { return []; } })();
        const pool = ctx.getEl('hiddenboard-slot-pool');
        
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

        const exactDepths = getHiddenboardDepths(mergedSlots);

        ctx._hiddenboardSlotElsByUid.forEach(el => {
            el.style.display = 'none'; el.classList.remove('is-visible','has-target','is-completed','highlighted-tree');
            if (pool && el.parentElement !== pool) pool.appendChild(el);
        });
        ctx.getEl('boardContent')?.querySelectorAll('.hiddenboard-page').forEach(el => el.remove());
        const gridFragments = new Map(Object.values(grids).filter(Boolean).map(grid => [grid, document.createDocumentFragment()]));
        const reasonEntriesCache = new Map();
        const getCachedReasonEntries = (slotId, rMap) => {
            if (!reasonEntriesCache.has(slotId)) reasonEntriesCache.set(slotId, getHiddenboardReasonDisplayEntries(slotId, rMap, reqMap));
            return reasonEntriesCache.get(slotId);
        };

        const visibleMaterialIds = new Set([...baseMap.keys(), ...reqMap.keys()]);

        const processSlot = (id) => {
            const slotEl = ctx._hiddenboardSlotElsByUid.get(id); if (!slotEl) return null;
            
            const isAutoCost = ctx.AUTO_COST_SLOT_SET.has(id);
            if (isAutoCost) return null;
            
            const isTarget = ctx.activeUnits.has(id);
            const isCompletedTarget = !isTarget && !isAutoCost && ctx.completedTargets.has(id);
            const isMergedSlot = isTarget && !isAutoCost && mergedSlots.has(id);
            
            let needed = reqMap.get(id) || 0;
            if (isMergedSlot) needed = Math.max(0, (baseMap.get(id)||0) - (ctx.completedUnits.get(id)||0));
            else if (isTarget && !isAutoCost) needed = Math.max(0, (ctx.activeUnits.get(id)||1) - (ctx.completedUnits.get(id)||0));
            if (isCompletedTarget) needed = 0;
            
            const baseNeeded = isTarget ? (isMergedSlot ? (baseMap.get(id)||0) : (ctx.activeUnits.get(id)||1)) :
                             isCompletedTarget ? (ctx.completedTargets.get(id)||1) :
                             (baseMap.get(id)||0);

            if (!baseNeeded && !isTarget && !isCompletedTarget) return null;

            renderHiddenboardSlotReasons({
                id, slotEl, needed, isTarget, isMergedSlot, reasonMap,
                getCachedReasonEntries, targetHighlight, highlightDeps
            });

            const isCompleted = needed === 0;
            slotEl.classList.toggle('has-target', !isCompleted);
            slotEl.classList.toggle('is-completed', isCompleted);

            let tGrid = null;

            const uGrade = ctx.unitMap.get(id)?.grade;
            const isHiddenGroup = ctx.getGradeIndex(uGrade) >= ctx.getGradeIndex(ctx.SYSTEM_CONFIG.policy.hiddenGroupMinGrade || "히든");
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
            else if (isBasicHiddenboardGrade(uGrade)) nativeGrid = grids.basicHidden;
            tGrid = upgradedGrid || nativeGrid;
            if (!tGrid) return null;

            const isFinalGoal = tGrid === grids.target;
            slotEl.classList.toggle('is-final-goal', isFinalGoal);
            if (isFinalGoal) renderHiddenboardRecipe(slotEl, calcResult);
            else switchHiddenboardDetail(id, slotEl.dataset.detailView, calcResult);
            const cWrap = slotEl.querySelector(`#craft-wrap-${id}`);
            if (cWrap) {
                if (!isCompleted) {
                    const tenDisabled = needed >= 10 ? '' : ' disabled';
                    const qtyButtons = isFinalGoal ? '' : `<button type="button" class="pc-btn" data-action="addComplete" data-uid="${id}" data-batch="1"><span class="batch-plus" aria-hidden="true">+</span>1개</button><button type="button" class="pc-btn" data-action="addComplete" data-uid="${id}" data-batch="10"${tenDisabled}><span class="batch-plus" aria-hidden="true">+</span>10개</button>`;
                    cWrap.innerHTML = `<div class="craft-wrap-left"><span class="req-text">${needed}</span><span class="req-label">개</span></div><div class="craft-wrap-right">${qtyButtons}<button type="button" class="btn-complete" data-action="completeUnit" data-uid="${id}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m5 12 4 4 10-10"/></svg>완료</button></div>`;
                } else cWrap.innerHTML = `<div class="craft-wrap-left"><span class="req-text">0</span><span class="req-label">개</span></div><div class="craft-wrap-right"><span class="complete-done-label">완료됨</span></div>`;
            }

            const trackingIcon = slotEl.querySelector('[data-info-view="usage"]');
            if (trackingIcon) {
                const isTracking = !!targetHighlight && ((isFinalGoal && targetHighlight === id) || trackingOriginId === id);
                const showTrackingHint = !!targetHighlight && trackingOriginId === id;
                const name = ctx.unitMap.get(id)?.name || id;
                trackingIcon.classList.toggle('is-tracking', isTracking);
                slotEl.querySelector('.d-tracking-bubble').hidden = !showTrackingHint;
                trackingIcon.setAttribute('aria-label', `${name} ${isTracking ? '추적 해제' : (isFinalGoal ? '목표추적' : '상위 조합 추적')}`);
                trackingIcon.title = isTracking ? '추적 해제' : (isFinalGoal ? '목표추적' : '상위 조합 추적 · 사용처');
                if (isFinalGoal || isTracking) {
                    trackingIcon.setAttribute('aria-pressed', String(isTracking));
                    trackingIcon.removeAttribute('aria-haspopup');
                    trackingIcon.removeAttribute('aria-expanded');
                    trackingIcon.removeAttribute('aria-controls');
                } else {
                    trackingIcon.removeAttribute('aria-pressed');
                    trackingIcon.setAttribute('aria-haspopup', 'dialog');
                    trackingIcon.setAttribute('aria-expanded', String(trackingIcon === detailTrigger));
                }
                if (showTrackingHint) trackingIcon.setAttribute('aria-describedby', `tracking-hint-${id}`);
                else trackingIcon.removeAttribute('aria-describedby');
            }

            const gridId = tGrid?.id || '';
            ctx._unitRestoreLevels.set(id, restoreLevelsByGridId[gridId] || 0);
            const keepCompletedVisible = excludeGridIds.includes(gridId);
            // 추적 대상과 그 재료만 표시하여 그리드를 빈자리 없이 다시 배치합니다.
            const outsideTracking = !!targetHighlight && !highlightDeps?.has(id);
            const hideT = outsideTracking || (ctx._hideCompleted && isCompleted && !keepCompletedVisible);
            if (tGrid) {
                if (!hideT) {
                    slotEl.classList.add('is-visible');
                } else {
                    slotEl.classList.remove('is-visible');
                }
                slotEl.style.display = hideT ? 'none' : 'flex';
                (gridFragments.get(tGrid) || tGrid).appendChild(slotEl);
            }

            
            return tGrid;
        };

        ctx.getUnitsFromIds(ctx.activeUnits.keys()).sort(ctx.compareUnitByHiddenboardPriority).forEach(u => processSlot(u.id));
        ctx.getUnitsFromIds(ctx.completedTargets.keys()).sort(ctx.compareUnitByGradeName).forEach(u => processSlot(u.id));

        ctx.getUnitsFromIds(Array.from(visibleMaterialIds)
            .filter(uid => !ctx.AUTO_COST_SLOT_SET.has(uid) && !ctx.activeUnits.has(uid) && !ctx.completedTargets.has(uid)))
            .sort(ctx.compareUnitByHiddenboardPriority)
            .forEach(u => processSlot(u.id));

        gridFragments.forEach((frag, grid) => { if (frag.childNodes.length > 0) grid.appendChild(frag); });

        sortHiddenboardGrids(grids);

        Object.values(grids).forEach(g => wrapHiddenboardGridPages(g, 6, !!targetHighlight));

        updateHiddenboardGroupVisibility(grids, targetHighlight, excludeGridIds);

        restoreHiddenboardGroupState(targetHighlight);

        ctx._hiddenboardSlotElsByUid.forEach((el, cleanId) => {
            el.classList.toggle('highlighted-tree', !!ctx._currentHighlight && highlightDeps?.has(cleanId));
        });
        updateGroupRestoreButtons();
    }

    function getHiddenboardRecipeCompletionCandidates(baseMap) {
        const depths = ctx.getBoardDependencyDepths();
        const candidates = new Map();

        const addCandidate = (uid, qty) => {
            const requiredQty = Math.max(0, parseInt(qty, 10) || 0);
            if (requiredQty <= 0 || !ctx.unitMap.has(uid) || ctx.completedTargets.has(uid)) return;
            const depth = depths.has(uid) ? depths.get(uid) : (ctx.activeUnits.has(uid) ? 0 : -1);
            if (depth < 0) return;
            candidates.set(uid, { unit: ctx.unitMap.get(uid), qty: requiredQty, depth });
        };

        baseMap.forEach((qty, uid) => addCandidate(uid, qty));
        ctx.activeUnits.forEach((qty, uid) => addCandidate(uid, qty));

        return [...candidates.values()].sort((a, b) =>
            b.depth - a.depth ||
            ctx.getGradeIndex(a.unit.grade) - ctx.getGradeIndex(b.unit.grade) ||
            a.unit.name.localeCompare(b.unit.name)
        );
    }

    function completeHiddenboardRecipeUnitsIfReady() {
        if (ctx._currentViewMode !== 'hiddenboard' || ctx.activeUnits.size === 0) return false;

        let changed = false;
        for (let pass = 0; pass < ctx.APP_INTERNAL.maxAutoCompletePasses && ctx.activeUnits.size > 0; pass++) {
            const activeSizeBefore = ctx.activeUnits.size;
            const { baseMap } = ctx.calculateBoardRequirements();
            const candidates = getHiddenboardRecipeCompletionCandidates(baseMap);
            let completedThisPass = false;

            for (const { unit, qty: requiredQty } of candidates) {
                const uid = unit.id;
                const currentCompleted = Math.max(0, parseInt(ctx.completedUnits.get(uid), 10) || 0);
                const targetQty = ctx.activeUnits.has(uid) ? (ctx.activeUnits.get(uid) || 1) : requiredQty;
                const remainingQty = Math.max(0, targetQty - currentCompleted);
                if (remainingQty <= 0) continue;

                const readyQty = ctx.getCompletedRecipeReadyQty(uid, remainingQty);
                if (readyQty <= 0) continue;

                ctx.deleteCompletedRecipe(uid, readyQty);
                if (ctx.activeUnits.has(uid)) {
                    const activeQty = ctx.activeUnits.get(uid) || 1;
                    const nextCompleted = currentCompleted + readyQty;
                    if (nextCompleted >= activeQty) {
                        ctx.completedTargets.set(uid, activeQty);
                        ctx.activeUnits.delete(uid);
                        ctx.pausedUnits.delete(uid);
                        ctx.completedUnits.delete(uid);
                                    } else {
                        ctx.completedUnits.set(uid, nextCompleted);
                    }
                } else {
                    ctx.addCompletedMaterialUnit(uid, readyQty);
                }

                completedThisPass = changed = true;
                if (ctx.activeUnits.size !== activeSizeBefore) break;
            }

            if (!completedThisPass || ctx.activeUnits.size === activeSizeBefore) break;
        }

        if (!changed) return false;
        ctx._currentHighlight = null;
        return true;
    }
    return { completeHiddenboardRecipeUnitsIfReady, completeUnit, placeHiddenboardControls, renderHiddenboard, resetGroupCompleted, returnHiddenboardControlsToHeader, switchHiddenboardDetail, updateHiddenboard };
};
