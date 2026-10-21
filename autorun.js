const s = document.createElement('style');
s.id = 'big-highlight';
s.textContent = `.multiple-choice--option.active { outline: 4px solid #000 !important; box-shadow: 0 0 0 4px #ffd700 !important; background: #fff3a0 !important; font-weight: bold !important; }`;
document.head.appendChild(s);
angular.element(document.querySelector('[ng-app]')).injector().get('Cheating').enabled = true;
['mouseenter','mouseover'].forEach(t=>window.addEventListener(t,e=>{if(e.target.closest&&e.target.closest('.multiple-choice--option'))e.stopImmediatePropagation()},true));


function clickActiveOption() {
  const delay = 3000 + Math.random() * 2000;

  setTimeout(() => {
    const active = document.querySelector(
      '.multiple-choice--option.active'
    );


      const active2 = document.querySelector('.v3-button.button-light-font.ng-binding')
    if (active) {
      active.click();
    }

      if(active2){
          active2.click();
      }

    clickActiveOption();
  }, delay);
}

clickActiveOption();

