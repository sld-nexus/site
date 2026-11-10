/* 기능 모듈 — V39 공통 상태·계산·저장은 app.js 단일 원본을 사용합니다. */
window.NEXUS_RESPONSIVE = function createResponsive(ctx) {
    'use strict';
    let _swipeTimer = null, _isSwiping = false;
    /* 재료보드 탭: 원본과 동일하게 PC 가로 화면에서만 생성한다. */
    let invenboardTabNode = null;
    const isDesktopInvenboardSupported = () => window.matchMedia('(min-width:1025px) and (min-aspect-ratio:11/10) and (hover:hover) and (pointer:fine)').matches
        && !document.documentElement.classList.contains('nexus-standalone-build');

    function syncInvenboardNav() {
        if (!isDesktopInvenboardSupported()) {
            if (ctx._currentViewMode === 'invenboard') ctx.switchLayout('unitboard');
            invenboardTabNode?.remove();
            return false;
        }
        if (!invenboardTabNode) invenboardTabNode = ctx.getEl('invenboardNavTemplate')?.content.firstElementChild.cloneNode(true);
        if (invenboardTabNode && !invenboardTabNode.isConnected) ctx.getEl('btnViewHiddenboard')?.after(invenboardTabNode);
        return true;
    }

    function updatePivotColumns() {
        const { width, height } = window.screen;
        const pixelRatio = window.devicePixelRatio || 1;
        const isPortraitDesktop = width < height && window.matchMedia('(hover:hover) and (pointer:fine)').matches;
        const pixelWidth = width * pixelRatio;
        const pixelHeight = height * pixelRatio;
        const columns = isPortraitDesktop && pixelWidth >= 2159 && pixelHeight >= 3839 ? '4'
            : isPortraitDesktop && pixelWidth >= 1439 && pixelHeight >= 2559 ? '3' : '';
        document.documentElement.dataset.pivotColumns = columns;
    }
    const handleViewportChange = () => {
        syncInvenboardNav();
        updatePivotColumns();
        ctx.hideRecipeTooltip();
        ctx.closeFontSizePopup();
        ctx.placeHiddenboardControls();
        ctx.updateBoardHeader();
    };
    window.addEventListener('orientationchange', handleViewportChange);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('focus', updatePivotColumns);

    /* 화면 스와이프 이벤트 */
    function bindSwipeEvents() {
        const sArea = ctx.getEl('tabContent');
        if (sArea) {
            let sX = 0, sY = 0, sPager = null;
            const getSwipePager = target => {
                const favPager = target?.closest?.('.unitboard-fav-grid');
                if (favPager) return { el: favPager, type: 'favorite' };
                const categoryPager = target?.closest?.('.unitboard-category-grid');
                return categoryPager ? { el: categoryPager, type: 'category' } : null;
            };
            const canPagerMove = (pagerState, dX) => {
                const pager = pagerState?.el;
                if (!pager) return false;
                const max = Math.max(0, pager.scrollWidth - pager.clientWidth);
                if (max <= 2) return false;
                const start = Math.max(0, Math.min(pagerState.scrollLeft, max));
                if (dX < 0) return start < max - 2;
                if (dX > 0) return start > 2;
                return false;
            };
            sArea.addEventListener('touchstart', e => {
                const touch = e.changedTouches[0];
                sX = touch.screenX; sY = touch.screenY;
                const pager = getSwipePager(e.target);
                sPager = pager ? { ...pager, scrollLeft: pager.el.scrollLeft } : null;
            }, { passive: true });
            sArea.addEventListener('touchend', e => {
                if (_isSwiping || ctx._unitboardCollection) return;
                let dX = e.changedTouches[0].screenX - sX, dY = e.changedTouches[0].screenY - sY;
                if (Math.abs(dX) > 70 && Math.abs(dY) < 50) {
                    if (sPager?.type === 'favorite') { sPager = null; return; }
                    if (sPager?.type === 'category' && canPagerMove(sPager, dX)) { sPager = null; return; }
                    _isSwiping = true;
                    if (dX > 0 && ctx._activeTabIdx > 0) ctx.selectTab(ctx._activeTabIdx - 1);
                    else if (dX < 0 && ctx._activeTabIdx < ctx.SYSTEM_CONFIG.tabs.length - 1) ctx.selectTab(ctx._activeTabIdx + 1);
                    if (_swipeTimer) clearTimeout(_swipeTimer);
                    _swipeTimer = setTimeout(() => _isSwiping = false, 300);
                }
                sPager = null;
            }, { passive: true });
        }
        const dBoard = ctx.getEl('colRightPanel');
        if (dBoard) {
            let dX0 = 0, dY0 = 0, dPager = false;
            dBoard.addEventListener('touchstart', e => {
                dX0 = e.changedTouches[0].screenX;
                dY0 = e.changedTouches[0].screenY;
                dPager = !!e.target?.closest?.('.hiddenboard-grid');
            }, { passive: true });
            dBoard.addEventListener('touchend', e => {
                const dx = e.changedTouches[0].screenX - dX0, dy = e.changedTouches[0].screenY - dY0;
                if (Math.abs(dx) > 80 && Math.abs(dy) < 50) {
                    if (dPager) { dPager = false; return; }
                    if (dx > 0) ctx.switchLayout('unitboard'); else ctx.switchLayout('hiddenboard');
                }
                dPager = false;
            }, { passive: true });
        }
    }
    return { bindSwipeEvents, isDesktopInvenboardSupported, syncInvenboardNav, updatePivotColumns };
};
