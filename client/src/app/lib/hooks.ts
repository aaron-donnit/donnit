import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import type { Bootstrap } from "@/app/types";

export function useBootstrap() {
  return useQuery<Bootstrap>({ queryKey: ["/api/bootstrap"] });
}

export function invalidateWorkspace() {
  return queryClient.invalidateQueries({ queryKey: ["/api/bootstrap"] });
}
