// Navigation helper script
function toggleMobileMenu() {
    document.getElementById('mobilePanel').classList.toggle('open');
}

// Scroll to consult form - fix for optional chaining error in onclick
function scrollToConsult() {
    const form = document.getElementById('consultForm');
    if (form) {
        form.scrollIntoView({ behavior: 'smooth' });
    } else {
        window.location.href = 'index.html#consultForm';
    }
}

// Dropdown navigation
document.addEventListener('DOMContentLoaded', function() {
    const navGroups = document.querySelectorAll('.nav-grp');
    navGroups.forEach(group => {
        const btn = group.querySelector('.nav-grp__btn');
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            navGroups.forEach(g => { if (g !== group) g.classList.remove('open'); });
            group.classList.toggle('open');
        });
    });
    document.addEventListener('click', function(e) {
        if (!e.target.closest('.nav-grp')) navGroups.forEach(g => g.classList.remove('open'));
    });
});
