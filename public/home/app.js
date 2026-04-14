/* ============================================================
   SiteAmoeba Landing Page v3 — JavaScript
   ============================================================ */

(function () {
  'use strict';

  /* ── Typing Hero Headline Effect ── */
  const typedEl = document.getElementById('heroTyped');
  const phrases = [
    'conversion machines',
    'revenue engines',
    'your best salesperson',
    'a competitive advantage',
    'profit centers',
    'customer magnets',
  ];
  let phraseIndex = 0;
  let charIndex = phrases[0].length; // Start at full length of first phrase (already displayed in HTML)
  let isDeleting = false;

  function typePhrase() {
    const current = phrases[phraseIndex];
    if (!typedEl) return;

    if (!isDeleting) {
      // Typing forward
      charIndex++;
      typedEl.textContent = current.substring(0, charIndex);
      if (charIndex >= current.length) {
        // Pause at full word, then start deleting
        setTimeout(() => { isDeleting = true; typePhrase(); }, 2200);
        return;
      }
      setTimeout(typePhrase, 70 + Math.random() * 40);
    } else {
      // Deleting (backspacing)
      charIndex--;
      typedEl.textContent = current.substring(0, charIndex);
      if (charIndex <= 0) {
        isDeleting = false;
        phraseIndex = (phraseIndex + 1) % phrases.length;
        charIndex = 0;
        setTimeout(typePhrase, 400);
        return;
      }
      setTimeout(typePhrase, 35);
    }
  }

  if (typedEl) {
    // Wait, then start backspacing the first phrase
    setTimeout(() => { isDeleting = true; typePhrase(); }, 2500);
  }

  /* ── Nav Scroll State ── */
  const nav = document.getElementById('nav');

  function onScroll() {
    const y = window.scrollY;
    if (y > 20) {
      nav.classList.add('nav--scrolled');
    } else {
      nav.classList.remove('nav--scrolled');
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });

  /* ── Mobile Menu ── */
  const hamburger = document.getElementById('navHamburger');
  const navLinks = document.getElementById('navLinks');

  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => {
      const isOpen = navLinks.classList.toggle('open');
      hamburger.classList.toggle('active');
      hamburger.setAttribute('aria-expanded', isOpen);
    });

    navLinks.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        navLinks.classList.remove('open');
        hamburger.classList.remove('active');
        hamburger.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* ── Scroll Reveal with stagger ── */
  const revealElements = document.querySelectorAll('.reveal');

  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        revealObserver.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.08,
    rootMargin: '0px 0px -40px 0px'
  });

  revealElements.forEach(el => revealObserver.observe(el));

  /* ── Animated Counters ── */
  function animateCounter(element, target, duration) {
    const start = 0;
    const startTime = performance.now();

    function update(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(start + (target - start) * eased);
      element.textContent = current.toLocaleString();

      if (progress < 1) {
        requestAnimationFrame(update);
      }
    }

    requestAnimationFrame(update);
  }

  const counterElements = document.querySelectorAll('[data-target]');
  const counterObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const target = parseInt(entry.target.getAttribute('data-target'), 10);
        animateCounter(entry.target, target, 1800);
        counterObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.3 });

  counterElements.forEach(el => counterObserver.observe(el));

  /* ── Smooth Scroll for Anchor Links ── */
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const id = this.getAttribute('href');
      if (id === '#') return;
      const target = document.querySelector(id);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });

  /* ── Enterprise Dropdown Toggle ── */
  const dropdownTrigger = document.querySelector('.nav__dropdown-trigger');
  if (dropdownTrigger) {
    dropdownTrigger.addEventListener('click', (e) => {
      const expanded = dropdownTrigger.getAttribute('aria-expanded') === 'true';
      dropdownTrigger.setAttribute('aria-expanded', !expanded);
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.nav__dropdown')) {
        dropdownTrigger.setAttribute('aria-expanded', 'false');
      }
    });
  }

})();

  /* ── Referral Link Passthrough ── */
  // If the landing page is loaded with ?ref=xxx, append it to all app links
  // so the signup form can capture the referral code
  (function() {
    var params = new URLSearchParams(window.location.search);
    var ref = params.get('ref');
    if (!ref) return;
    
    // Find all links pointing to app.siteamoeba.com and append ?ref=
    var links = document.querySelectorAll('a[href*="app.siteamoeba.com"]');
    links.forEach(function(link) {
      var href = link.getAttribute('href');
      var separator = href.indexOf('?') === -1 ? '?' : '&';
      link.setAttribute('href', href + separator + 'ref=' + encodeURIComponent(ref));
    });
  })();
