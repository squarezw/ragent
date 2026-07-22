import type { NextApiRequest, NextApiResponse } from "next";
import bcrypt from "bcryptjs";
import { getUserIdFromRequest } from "@/lib/auth";
import {
  canManageTenant,
  canManageDept,
  isSuperAdmin,
  getUserPermissions,
} from "@/lib/permissions";
import pool from "@/lib/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "PUT") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const tokenUserId = getUserIdFromRequest(req);
    if (!tokenUserId) return res.status(401).json({ error: "未登录" });

    // 获取用户权限信息
    const userPerms = await getUserPermissions(tokenUserId);
    if (!userPerms) {
      return res.status(404).json({ error: "用户不存在" });
    }

    const {
      id,
      username,
      nickname,
      password,
      currentPassword,
      email,
      role,
      tenant_id,
      dept_id,
      status,
      wechat_id,
    } = req.body;

    // 判断目标 id
    let targetId = id;
    if (!id) {
      // 普通用户修改自己信息
      targetId = tokenUserId;
    } else if (id !== tokenUserId) {
      // 检查是否有权限修改他人信息
      const isSuper = await isSuperAdmin(tokenUserId);
      if (!isSuper) {
        // 检查租户和部门权限
        const targetUserRes = await pool.query(
          "SELECT tenant_id, dept_id FROM users WHERE id = $1",
          [targetId]
        );
        if (!targetUserRes.rowCount || targetUserRes.rowCount === 0) {
          return res.status(404).json({ error: "目标用户不存在" });
        }

        const targetUser = targetUserRes.rows[0];
        if (userPerms.tenantId) {
          // 租户管理员只能修改自己租户的用户
          if (targetUser.tenant_id !== userPerms.tenantId) {
            return res.status(403).json({ error: "无权限修改其他租户的用户" });
          }
          if (dept_id && !(await canManageDept(tokenUserId, dept_id))) {
            return res.status(403).json({ error: "无权限修改到指定部门" });
          }
        } else if (userPerms.deptId) {
          // 部门管理员只能修改自己部门的用户
          if (targetUser.dept_id !== userPerms.deptId) {
            return res.status(403).json({ error: "无权限修改其他部门的用户" });
          }
        } else {
          return res.status(403).json({ error: "无权限修改他人信息" });
        }
      }
    }

    const client = await pool.connect();
    try {
      // 检查邮箱唯一性（排除自身）
      if (email) {
        const exists = await client.query("SELECT 1 FROM users WHERE email=$1 AND id<>$2", [
          email,
          targetId,
        ]);
        if (exists.rowCount && exists.rowCount > 0) {
          return res.status(409).json({ error: "邮箱已被使用" });
        }
      }

      // 构建更新字段
      const updateFields = [];
      const updateValues = [];
      let paramIndex = 1;

      // 权限控制逻辑
      const isSelfUpdate = targetId === tokenUserId;
      const isSuper = await isSuperAdmin(tokenUserId);
      const isTenantAdmin = userPerms.roles.some((role) => role.name === "租户管理员");
      const isDeptAdmin = userPerms.roles.some((role) => role.name === "部门管理员");

      // 身份修改权限检查
      if (role) {
        // 获取目标用户的角色信息
        const targetUserRolesRes = await client.query(
          `
          SELECT r.name 
          FROM user_roles ur 
          JOIN roles r ON ur.role_id = r.id 
          WHERE ur.user_id = $1
        `,
          [targetId]
        );

        const targetUserRoles = targetUserRolesRes.rows.map((row) => row.name);
        const currentUserRoles = userPerms.roles.map((r) => r.name);

        // 检查是否有权限修改身份
        if (isSuper) {
          // 超级管理员可以修改任何用户的身份
          // 注意：这里不直接更新role字段，而是通过user_roles表更新
        } else if (currentUserRoles.includes("租户管理员")) {
          // 租户管理员可以修改部门管理员或普通用户为租户管理员或部门管理员，也可以修改自己的身份
          if (targetId === tokenUserId) {
            // 如果是修改自己的身份，允许修改
            const isNewRoleValid = role === "租户管理员" || role === "部门管理员";
            if (!isNewRoleValid) {
              return res
                .status(403)
                .json({ error: "租户管理员只能将自己的身份修改为租户管理员或部门管理员" });
            }
          } else {
            // 修改他人身份时的权限检查
            const isTargetLowerRole =
              targetUserRoles.includes("部门管理员") || targetUserRoles.includes("普通用户");
            const isNewRoleValid = role === "租户管理员" || role === "部门管理员";
            if (!isTargetLowerRole || !isNewRoleValid) {
              return res
                .status(403)
                .json({ error: "租户管理员只能修改部门管理员或普通用户的身份" });
            }
          }
        } else if (currentUserRoles.includes("部门管理员")) {
          // 部门管理员只能修改普通用户为部门管理员
          if (targetId === tokenUserId) {
            return res.status(403).json({ error: "部门管理员不能修改自己的身份" });
          }

          const isTargetNormalUser = targetUserRoles.includes("普通用户");
          const isNewRoleDeptAdmin = role === "部门管理员";
          if (!isTargetNormalUser || !isNewRoleDeptAdmin) {
            return res.status(403).json({ error: "部门管理员只能将普通用户提升为部门管理员" });
          }
        } else {
          return res.status(403).json({ error: "无权限修改用户身份" });
        }
      }

      // 超级管理员可以修改所有字段
      if (isSuper) {
        if (username) {
          updateFields.push(`username = $${paramIndex++}`);
          updateValues.push(username);
        }

        if (nickname !== undefined) {
          updateFields.push(`nickname = $${paramIndex++}`);
          updateValues.push(nickname);
        }

        if (email !== undefined) {
          updateFields.push(`email = $${paramIndex++}`);
          updateValues.push(email);
        }

        if (wechat_id !== undefined) {
          updateFields.push(`wechat_id = $${paramIndex++}`);
          updateValues.push(wechat_id);
        }
      } else if (isTenantAdmin || isDeptAdmin) {
        // 租户管理员和部门管理员可以修改昵称和邮箱
        if (nickname !== undefined) {
          updateFields.push(`nickname = $${paramIndex++}`);
          updateValues.push(nickname);
        }

        if (email !== undefined) {
          updateFields.push(`email = $${paramIndex++}`);
          updateValues.push(email);
        }

        if (wechat_id !== undefined) {
          updateFields.push(`wechat_id = $${paramIndex++}`);
          updateValues.push(wechat_id);
        }
      } else if (isSelfUpdate) {
        // 普通用户只能修改自己的昵称、邮箱和微信ID
        if (nickname !== undefined) {
          updateFields.push(`nickname = $${paramIndex++}`);
          updateValues.push(nickname);
        }

        if (email !== undefined) {
          updateFields.push(`email = $${paramIndex++}`);
          updateValues.push(email);
        }

        if (wechat_id !== undefined) {
          updateFields.push(`wechat_id = $${paramIndex++}`);
          updateValues.push(wechat_id);
        }
      }

      if (password) {
        // 如果提供了当前密码，需要验证
        if (currentPassword) {
          const currentUserRes = await client.query("SELECT password FROM users WHERE id = $1", [
            targetId,
          ]);
          if (!currentUserRes.rowCount || currentUserRes.rowCount === 0) {
            return res.status(404).json({ error: "用户不存在" });
          }

          const currentUser = currentUserRes.rows[0];
          const isValidPassword = await bcrypt.compare(currentPassword, currentUser.password);
          if (!isValidPassword) {
            return res.status(400).json({ error: "当前密码错误" });
          }
        }

        const hashed = await bcrypt.hash(password, 10);
        updateFields.push(`password = $${paramIndex++}`);
        updateValues.push(hashed);
      }

      // 租户和部门信息修改权限
      if (isSuper) {
        // 超级管理员可以修改租户和部门信息
        if (tenant_id !== undefined) {
          updateFields.push(`tenant_id = $${paramIndex++}`);
          updateValues.push(tenant_id);
        }
        if (dept_id !== undefined) {
          updateFields.push(`dept_id = $${paramIndex++}`);
          updateValues.push(dept_id);
        }
      } else if (isTenantAdmin) {
        // 租户管理员可以修改部门信息，但不能修改租户信息
        if (dept_id !== undefined) {
          // 验证部门是否属于当前租户
          if (dept_id) {
            const deptRes = await client.query("SELECT tenant_id FROM dept WHERE id = $1", [
              dept_id,
            ]);
            if (!deptRes.rowCount || deptRes.rowCount === 0) {
              return res.status(400).json({ error: "部门不存在" });
            }
            if (deptRes.rows[0].tenant_id !== userPerms.tenantId) {
              return res.status(403).json({ error: "无权限修改到其他租户的部门" });
            }
          }
          updateFields.push(`dept_id = $${paramIndex++}`);
          updateValues.push(dept_id);
        }
      }

      // 状态修改权限：只有超级管理员可以修改其他管理员的状态
      if (status !== undefined) {
        // 检查是否有权限修改状态
        if (isSelfUpdate) {
          // 用户可以修改自己的状态
          updateFields.push(`status = $${paramIndex++}`);
          updateValues.push(status);
        } else if (isSuper) {
          // 超级管理员可以修改任何用户的状态
          updateFields.push(`status = $${paramIndex++}`);
          updateValues.push(status);
        } else if (isTenantAdmin) {
          // 租户管理员可以修改部门管理员和普通用户的状态，但不能修改超级管理员和其他租户管理员的状态
          const targetUserRolesRes = await client.query(
            `
            SELECT r.name 
            FROM user_roles ur 
            JOIN roles r ON ur.role_id = r.id 
            WHERE ur.user_id = $1
          `,
            [targetId]
          );

          const targetUserRoles = targetUserRolesRes.rows.map((row) => row.name);
          const isTargetSuperAdmin = targetUserRoles.includes("超级管理员");
          const isTargetTenantAdmin = targetUserRoles.includes("租户管理员");

          if (isTargetSuperAdmin || isTargetTenantAdmin) {
            return res
              .status(403)
              .json({ error: "租户管理员不能修改超级管理员或其他租户管理员的状态" });
          }

          updateFields.push(`status = $${paramIndex++}`);
          updateValues.push(status);
        } else if (isDeptAdmin) {
          // 部门管理员只能修改普通用户的状态，不能修改任何管理员的状态
          const targetUserRolesRes = await client.query(
            `
            SELECT r.name 
            FROM user_roles ur 
            JOIN roles r ON ur.role_id = r.id 
            WHERE ur.user_id = $1
          `,
            [targetId]
          );

          const targetUserRoles = targetUserRolesRes.rows.map((row) => row.name);
          const isTargetAdmin = targetUserRoles.some(
            (role) => role === "超级管理员" || role === "租户管理员" || role === "部门管理员"
          );

          if (isTargetAdmin) {
            return res.status(403).json({ error: "部门管理员不能修改其他管理员的状态" });
          }

          updateFields.push(`status = $${paramIndex++}`);
          updateValues.push(status);
        } else {
          return res.status(403).json({ error: "无权限修改用户状态" });
        }
      }

      updateFields.push(`updated_at = NOW()`);
      updateValues.push(targetId);

      const query = `UPDATE users SET ${updateFields.join(", ")} WHERE id = $${paramIndex} RETURNING id, username, nickname, email, tenant_id, dept_id, status, wechat_id`;
      const result = await client.query(query, updateValues);

      // 如果需要更新角色
      if (role) {
        const roleMap: { [key: string]: number } = {
          超级管理员: 1,
          租户管理员: 2,
          部门管理员: 3,
          普通用户: 4,
        };

        const newRoleId = roleMap[role];
        if (!newRoleId) {
          return res.status(400).json({ error: `无效的角色名称: ${role}` });
        }

        // 删除旧角色
        await client.query("DELETE FROM user_roles WHERE user_id = $1", [targetId]);
        // 分配新角色
        await client.query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)", [
          targetId,
          newRoleId,
        ]);
      }

      if (!result.rowCount || result.rowCount === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      // 获取用户角色信息
      const userRolesRes = await client.query(
        `
        SELECT r.name 
        FROM user_roles ur 
        JOIN roles r ON ur.role_id = r.id 
        WHERE ur.user_id = $1
      `,
        [targetId]
      );

      const userRoles = userRolesRes.rows.map((row) => row.name);
      const userWithRole = {
        ...result.rows[0],
        role: userRoles[0] || "普通用户",
      };

      res.status(200).json({ user: userWithRole });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("更新用户 API 错误:", err);
    res.status(500).json({ error: "Database error", details: err });
  }
}
