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
  KeyRound,
} from "lucide-react";
import { logout } from "@/app/actions";
import type { PermissionKey } from "@/lib/authorization-core";
import { visibleNavigationItems } from "@/lib/navigation";

const icons = {
  dashboard: LayoutDashboard,
  orders: ClipboardList,
  units: Building2,
  logistics: Layers,
  routes: Route,
  vehicles: Bus,
  drivers: Users,
  professionals: Settings,
  audit: ShieldCheck,
  access_profiles: KeyRound,
} as const;

export function Shell({
  children,
  name,
  admin,
  canCreate,
  permissions,
}: {
  children: React.ReactNode;
  name: string;
  admin: boolean;
  canCreate: boolean;
  permissions: PermissionKey[];
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const visible = visibleNavigationItems(new Set(permissions), admin);
  const mainLinks = visible.filter((item) => item.section === "main");
  const administrationLinks = visible.filter(
    (item) => item.section === "administration",
  );
  const homeHref = mainLinks[0]?.href ?? "/sem-acesso";
  return (
    <div className="app-shell">
      <a className="skip" href="#conteudo">
        Pular para conteúdo
      </a>
      <aside
        className={`sidebar ${open ? "expanded" : ""}`}
        id="menu-principal"
      >
        <Link className="brand" href={homeHref}>
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
          {mainLinks.map((item) => {
            const Icon = icons[item.id];
            return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              aria-current={path === item.href ? "page" : undefined}
              className={path.startsWith(item.href) ? "selected" : ""}
            >
              <Icon size={18} />
              {item.label}
            </Link>
            );
          })}
          {administrationLinks.length > 0 && (
            <>
              <p className="nav-label">ADMINISTRAÇÃO</p>
              {administrationLinks.map((item) => {
                const Icon = icons[item.id];
                return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={path === item.href ? "selected" : ""}
                >
                  <Icon size={18} />
                  {item.label}
                </Link>
                );
              })}
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
