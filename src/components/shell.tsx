"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  ClipboardList,
  Building2,
  Layers,
  Route,
  Bus,
  Users,
  Settings,
  LogOut,
  Menu,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { logout } from "@/app/actions";
const links = [
  ["/painel", "Visão geral", LayoutDashboard],
  ["/ordens", "Ordens de serviço", ClipboardList],
  ["/unidades", "Unidades", Building2],
  ["/cadastros/logistics", "Logística", Layers],
  ["/cadastros/routes", "Rotas", Route],
  ["/cadastros/vehicles", "Veículos", Bus],
  ["/cadastros/drivers", "Motoristas", Users],
] as const;
export function Shell({
  children,
  name,
  admin,
  canCreate,
}: {
  children: React.ReactNode;
  name: string;
  admin: boolean;
  canCreate: boolean;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <div className="app-shell">
      <a className="skip" href="#conteudo">
        Pular para conteúdo
      </a>
      <aside
        className={`sidebar ${open ? "expanded" : ""}`}
        id="menu-principal"
      >
        <Link className="brand" href="/painel">
          SIGMA <b>SEMED</b>
        </Link>
        <p className="brand-description">
          Gestão, Monitoramento
          <br />e Aprendizagem
        </p>
        <div className="module-label">
          OS SEMED <span>ORDENS DE SERVIÇO</span>
        </div>
        <nav aria-label="Menu principal">
          {links.map(([href, label, Icon]) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              aria-current={path === href ? "page" : undefined}
              className={path.startsWith(href) ? "selected" : ""}
            >
              <Icon size={18} />
              {label}
            </Link>
          ))}
          {admin && (
            <>
              <p className="nav-label">ADMINISTRAÇÃO</p>
              <Link
                href="/usuarios"
                onClick={() => setOpen(false)}
                className={path === "/usuarios" ? "selected" : ""}
              >
                <Settings size={18} />
                Usuários e vínculos
              </Link>
              <Link
                href="/auditoria"
                onClick={() => setOpen(false)}
                className={path === "/auditoria" ? "selected" : ""}
              >
                <ShieldCheck size={18} />
                Auditoria
              </Link>
            </>
          )}
        </nav>
        <div className="sidebar-footer">
          Secretaria Municipal
          <br />
          de Educação
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="row">
            <button
              className="mobile-menu secondary"
              aria-label={open ? "Fechar menu" : "Abrir menu"}
              aria-expanded={open}
              aria-controls="menu-principal"
              onClick={() => setOpen(!open)}
            >
              <Menu size={20} />
            </button>
            <div>
              <strong>Painel administrativo</strong>
              <small>OS SEMED · Gestão de serviços</small>
            </div>
          </div>
          <div className="row">
            <span className="user-name">{name}</span>
            <form action={logout}>
              <button className="icon-button" title="Sair" aria-label="Sair">
                <LogOut size={19} />
              </button>
            </form>
          </div>
        </header>
        <main id="conteudo" className="main-content">
          <div className="breadcrumb">
            <span>SEMED / Ordens de serviço</span>
            {canCreate && (
              <Link className="button small" href="/ordens/nova">
                <Plus size={16} /> Nova OS
              </Link>
            )}
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
