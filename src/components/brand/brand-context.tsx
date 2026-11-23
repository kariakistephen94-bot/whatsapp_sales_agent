"use client";
import { createContext, useContext } from "react";
import type { Brand } from "@/modules/industries/prompt-examples";

const Ctx = createContext<Brand>({});
export const BrandProvider = ({ brand, children }: { brand: Brand; children: React.ReactNode }) => <Ctx.Provider value={brand}>{children}</Ctx.Provider>;
/** What the current workspace is (name, category, what it offers): drives brand-specific example prompts. */
export const useBrand = () => useContext(Ctx);
