"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, X } from "lucide-react";
import axios from "@/lib/axios";
import { toast } from "sonner";

interface User {
  id: number;
  username: string;
  nickname: string;
  email?: string;
}

interface UserSearchDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (user: User) => void;
  currentUserId?: number;
}

export const UserSearchDialog = ({
  isOpen,
  onClose,
  onSelect,
  currentUserId,
}: UserSearchDialogProps) => {
  const t = useTranslations("common");
  const [searchQuery, setSearchQuery] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 搜索用户
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery("");
      setUsers([]);
      setSelectedUser(null);
      return;
    }

    const searchUsers = async () => {
      if (!searchQuery.trim()) {
        setUsers([]);
        return;
      }

      setLoading(true);
      try {
        const response = await axios.get("/api/user/list", {
          params: {
            username: searchQuery.trim(),
          },
        });

        const allUsers = response.data.users || [];
        // 过滤掉当前用户（如果提供了）
        const filteredUsers = currentUserId
          ? allUsers.filter((u: User) => u.id !== currentUserId)
          : allUsers;

        setUsers(filteredUsers);
      } catch (error: any) {
        console.error("Search users failed:", error);
        toast.error(error.response?.data?.error || t("searchUsersFailed"));
        setUsers([]);
      } finally {
        setLoading(false);
      }
    };

    // 防抖：延迟 300ms 后搜索
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      searchUsers();
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, isOpen, currentUserId]);

  const handleSelect = (user: User) => {
    setSelectedUser(user);
  };

  const handleConfirm = () => {
    if (selectedUser) {
      onSelect(selectedUser);
      onClose();
    }
  };

  const handleClose = () => {
    setSearchQuery("");
    setUsers([]);
    setSelectedUser(null);
    onClose();
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={handleClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg bg-card p-6 shadow-lg">
          <Dialog.Title className="text-lg font-bold mb-4">{t("selectUser")}</Dialog.Title>

          <div className="space-y-4">
            {/* 搜索框 */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                className="pl-10"
                placeholder={t("searchUserPlaceholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
              />
            </div>

            {/* 用户列表 */}
            {loading ? (
              <div className="text-center py-8 text-muted-foreground">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto"></div>
                <p className="mt-2 text-sm">{t("searching")}</p>
              </div>
            ) : searchQuery.trim() && users.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                {t("noUsersFound")}
              </div>
            ) : users.length > 0 ? (
              <div className="max-h-60 overflow-y-auto border rounded">
                {users.map((user) => (
                  <div
                    key={user.id}
                    className={`p-3 cursor-pointer hover:bg-muted border-b last:border-b-0 ${
                      selectedUser?.id === user.id ? "bg-blue-50" : ""
                    }`}
                    onClick={() => handleSelect(user)}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-sm">{user.nickname || user.username}</div>
                        <div className="text-xs text-muted-foreground">
                          {user.username}
                          {user.email && ` • ${user.email}`}
                        </div>
                      </div>
                      {selectedUser?.id === user.id && (
                        <div className="text-primary text-sm">✓</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400 text-sm">
                {t("enterUsernameToSearch")}
              </div>
            )}

            {/* 已选择的用户 */}
            {selectedUser && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded">
                <div className="text-xs text-muted-foreground mb-1">{t("selectedColon")}</div>
                <div className="font-medium text-sm">
                  {selectedUser.nickname || selectedUser.username}
                </div>
                <div className="text-xs text-muted-foreground">{selectedUser.username}</div>
              </div>
            )}
          </div>

          <div className="flex gap-2 justify-end mt-6">
            <Button variant="outline" onClick={handleClose}>
              {t("cancel")}
            </Button>
            <Button onClick={handleConfirm} disabled={!selectedUser}>
              {t("confirm")}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
