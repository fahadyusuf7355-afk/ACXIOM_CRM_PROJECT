import { Link, useNavigate, useLocation } from 'react-router-dom';
import FormBuilder from '../components/FormBuilder';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import api from '../utils/api';

const AuthCard = ({ title, subtitle, children }) => (
  <div className="auth-split">
    <section className="auth-brand">
      <div className="d-flex align-items-center gap-2 position-relative" style={{ zIndex: 1 }}>
        <div className="brand-mark" style={{ background: 'rgba(255,255,255,.18)' }}>A</div>
        <strong className="fs-5">AcxiomCRM</strong>
      </div>
      <div className="position-relative" style={{ zIndex: 1 }}>
        <h2 className="mb-4">From first lead to closed deal, in one workspace.</h2>
        <div className="feat"><i className="bi bi-funnel" />Capture, qualify and convert leads</div>
        <div className="feat"><i className="bi bi-kanban" />Track every opportunity through the pipeline</div>
        <div className="feat"><i className="bi bi-calendar2-check" />Never miss a follow-up</div>
        <div className="feat"><i className="bi bi-shield-check" />Role-based access with full audit trail</div>
      </div>
      <small className="opacity-75 position-relative" style={{ zIndex: 1 }}>© {new Date().getFullYear()} AcxiomCRM</small>
    </section>
    <section className="auth-form">
      <div className="inner">
        <h1 className="page-title mb-1">{title}</h1>
        <p className="page-sub mb-4">{subtitle}</p>
        {children}
      </div>
    </section>
  </div>
);

export function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  return (
    <AuthCard title="Welcome back" subtitle="Sign in to your AcxiomCRM account.">
      <FormBuilder
        submitLabel="Login"
        fields={[
          { name: 'login', label: 'Username or Email', required: true, maxLength: 254, col: 'col-12', autoComplete: 'username' },
          { name: 'password', label: 'Password', type: 'password', required: true, col: 'col-12', autoComplete: 'current-password' }
        ]}
        onSubmit={async (v) => {
          const u = await login(v.login, v.password);
          nav(u.mustChangePassword ? '/change-password' : (loc.state?.from || '/'), { replace: true });
        }}
      />
      <div className="mt-3 text-center small">New user? <Link to="/register">Create an account</Link></div>
      <div className="mt-4 p-3 rounded-3 small" style={{ background: 'var(--acx-teal-soft)' }}><strong className="text-primary">Demo accounts</strong><br />admin · neha.manager · rahul.sales — password <code>Acxiom@2026</code></div>
    </AuthCard>
  );
}

export const passwordHelp = 'Min 8 characters with uppercase, lowercase, digit and special character.';

export function Register() {
  const { register } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  return (
    <AuthCard title="Create your account" subtitle="Register to start managing your sales workspace.">
      <FormBuilder
        submitLabel="Register"
        fields={[
          { name: 'name', label: 'Full Name', required: true, minLength: 2, maxLength: 100, col: 'col-12' },
          { name: 'username', label: 'Username', required: true, minLength: 3, maxLength: 30, custom: (v) => (/^[a-zA-Z0-9._-]+$/.test(v) ? null : 'Username may contain only letters, digits, dot, underscore and hyphen.') },
          { name: 'phone', label: 'Phone', phone: true, maxLength: 10 },
          { name: 'email', label: 'Email', required: true, email: true, maxLength: 254, col: 'col-12' },
          { name: 'password', label: 'Password', type: 'password', required: true, password: true, help: passwordHelp, autoComplete: 'new-password' },
          { name: 'confirmPassword', label: 'Confirm Password', type: 'password', required: true, match: 'password', autoComplete: 'new-password' }
        ]}
        onSubmit={async (v) => { await register(v); toast('Welcome to AcxiomCRM!'); nav('/'); }}
      />
      <div className="mt-3 text-center small">Already registered? <Link to="/login">Sign in</Link></div>
    </AuthCard>
  );
}

export function ChangePassword() {
  const { user, refresh } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  return (
    <div className="container py-5" style={{ maxWidth: 560 }}>
      <div className="card p-4">
        <div className="d-flex align-items-center gap-3 mb-3"><div className="page-icon"><i className="bi bi-key" /></div><h1 className="page-title">Change Password</h1></div>
        {user?.mustChangePassword && <div className="alert alert-warning py-2">Your administrator issued a temporary password. Please set a new password to continue.</div>}
        <FormBuilder
          submitLabel="Change Password"
          onCancel={user?.mustChangePassword ? undefined : () => nav(-1)}
          fields={[
            { name: 'currentPassword', label: 'Current Password', type: 'password', required: true, col: 'col-12', autoComplete: 'current-password' },
            { name: 'newPassword', label: 'New Password', type: 'password', required: true, password: true, help: passwordHelp, col: 'col-12', autoComplete: 'new-password' },
            { name: 'confirmPassword', label: 'Confirm New Password', type: 'password', required: true, match: 'newPassword', col: 'col-12', autoComplete: 'new-password' }
          ]}
          onSubmit={async (v) => { await api.post('/auth/change-password', v); await refresh(); toast('Password changed successfully.'); nav('/'); }}
        />
      </div>
    </div>
  );
}
